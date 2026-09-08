"use client";

import React, { useEffect, useMemo, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import ContractAttachmentButton from "@/components/contracts/ContractAttachmentButton";
import ContractLinkedInvoicesModal from "@/components/contracts/ContractLinkedInvoicesModal";
import ContractPrintTemplate, {
  type ContractPrintData,
} from "@/components/contracts/ContractPrintTemplate";
import ContractStatsCards from "@/components/contracts/ContractStatsCards";
import {
  Ban,
  FileText,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import { deleteContractAction } from "@/lib/actions/entityDelete";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import { useDocumentPrint } from "@/hooks/useDocumentPrint";
import {
  createContract,
  fetchContracts,
  formatContractOptionLabel,
  generateContractNumber,
  getContractStatusLabel,
  getContractTypeLabel,
  updateContract,
  type Contract,
  type ContractStatus,
  type ContractType,
} from "@/lib/contracts/api";
import { filterLegalCustomers, filterLegalSuppliers } from "@/lib/customers/entityType";
import { DEFAULT_COMPANY_BRANDING, type CompanyBranding } from "@/lib/print/types";
import { supabase } from "@/lib/supabase";
import type { Customer, Supplier } from "@/types/database.types";

const TYPE_TABS: Array<"all" | ContractType> = ["all", "sale", "purchase", "service"];
const STATUS_TABS: Array<"all" | ContractStatus> = [
  "all",
  "active",
  "completed",
  "cancelled",
];

export default function ContractsPageClient() {
  const { t } = useI18n();
  const { can } = useAuth();
  const canManage = can("can_create_invoice") || can("can_view_purchases");
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const { printData, setPrintData } = useDocumentPrint<ContractPrintData>();

  const [contracts, setContracts] = useState<Contract[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [branding, setBranding] = useState<CompanyBranding>(DEFAULT_COMPANY_BRANDING);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"all" | ContractType>("all");
  const [filterStatus, setFilterStatus] = useState<"all" | ContractStatus>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [linkedContract, setLinkedContract] = useState<Contract | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Contract | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Contract | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [form, setForm] = useState({
    contract_number: "",
    type: "sale" as ContractType,
    party_id: "",
    title: "",
    total_amount: "",
    status: "active" as ContractStatus,
    advance_percentage: "",
    payment_stages: "",
    payment_terms_notes: "",
    contract_date: new Date().toISOString().slice(0, 10),
    expiry_date: "",
  });

  const loadData = async () => {
    setLoading(true);
    const [contractRows, customerRes, supplierRes, companyRes] = await Promise.all([
      fetchContracts(),
      supabase.from("customers").select("*").order("full_name"),
      supabase.from("suppliers").select("*").order("full_name"),
      supabase.from("company_settings").select("*").limit(1).maybeSingle(),
    ]);

    setContracts(contractRows);
    setCustomers((customerRes.data as Customer[]) || []);
    setSuppliers((supplierRes.data as Supplier[]) || []);

    if (companyRes.data) {
      const row = companyRes.data;
      setBranding({
        companyName: String(row.company_name || DEFAULT_COMPANY_BRANDING.companyName),
        logoUrl: row.logo_url != null ? String(row.logo_url) : null,
        voen: row.voen != null ? String(row.voen) : null,
        address: row.address != null ? String(row.address) : null,
        phone: row.phone != null ? String(row.phone) : null,
        email: row.email != null ? String(row.email) : null,
        bankName: row.bank_name != null ? String(row.bank_name) : null,
        iban: row.iban != null ? String(row.iban) : null,
      });
    }

    setLoading(false);
  };

  useEffect(() => {
    void loadData();
  }, []);

  const legalCustomers = useMemo(() => filterLegalCustomers(customers), [customers]);
  const legalSuppliers = useMemo(() => filterLegalSuppliers(suppliers), [suppliers]);

  const partyOptions = useMemo(() => {
    if (form.type === "purchase") {
      return legalSuppliers.map((s) => ({
        id: s.id,
        name: s.full_name || s.company_name || "-",
        voen: s.voen,
      }));
    }
    return legalCustomers.map((c) => ({
      id: c.id,
      name: c.full_name || c.company_name || c.name || "-",
      voen: c.voen,
    }));
  }, [form.type, legalCustomers, legalSuppliers]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return contracts.filter((c) => {
      if (filterType !== "all" && c.type !== filterType) return false;
      if (filterStatus !== "all" && c.status !== filterStatus) return false;
      if (!term) return true;
      return (
        c.contract_number.toLowerCase().includes(term) ||
        c.title.toLowerCase().includes(term) ||
        (c.party_name || "").toLowerCase().includes(term) ||
        (c.voen || "").toLowerCase().includes(term)
      );
    });
  }, [contracts, search, filterType, filterStatus]);

  const resetForm = (type: ContractType = "sale") => ({
    contract_number: generateContractNumber(type),
    type,
    party_id: "",
    title: "",
    total_amount: "",
    status: "active" as ContractStatus,
    advance_percentage: "",
    payment_stages: "",
    payment_terms_notes: "",
    contract_date: new Date().toISOString().slice(0, 10),
    expiry_date: "",
  });

  const openCreate = () => {
    setEditingId(null);
    setForm(resetForm("sale"));
    setModalOpen(true);
  };

  const openEdit = (contract: Contract) => {
    setEditingId(contract.id);
    setForm({
      contract_number: contract.contract_number,
      type: contract.type,
      party_id: contract.party_id,
      title: contract.title,
      total_amount: contract.total_amount != null ? String(contract.total_amount) : "",
      status: contract.status,
      advance_percentage:
        contract.advance_percentage != null ? String(contract.advance_percentage) : "",
      payment_stages: contract.payment_stages != null ? String(contract.payment_stages) : "",
      payment_terms_notes: contract.payment_terms_notes || "",
      contract_date: contract.contract_date || new Date().toISOString().slice(0, 10),
      expiry_date: contract.expiry_date || "",
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) {
      showError(t("common.noPermission"));
      return;
    }
    if (!form.party_id || !form.title.trim()) {
      showError(t("official.contractFieldsRequired"));
      return;
    }

    const party = partyOptions.find((p) => p.id === form.party_id);
    if (!party?.voen?.trim()) {
      showError(t("official.legalPartyVoenRequired"));
      return;
    }

    setSaving(true);
    const payload = {
      contract_number: form.contract_number.trim(),
      party_id: form.party_id,
      party_name: party?.name ?? null,
      type: form.type,
      title: form.title.trim(),
      total_amount: form.total_amount.trim() ? Number(form.total_amount) : null,
      status: form.status,
      voen: party.voen.trim(),
      advance_percentage: form.advance_percentage.trim() ? Number(form.advance_percentage) : null,
      payment_stages: form.payment_stages.trim() ? Number(form.payment_stages) : null,
      payment_terms_notes: form.payment_terms_notes.trim() || null,
      contract_date: form.contract_date || null,
      expiry_date: form.expiry_date || null,
    };

    const result = editingId
      ? await updateContract(editingId, payload)
      : await createContract(payload);
    setSaving(false);

    if (!result.ok) {
      showError(result.error);
      return;
    }

    showSuccess(t("common.success"));
    setModalOpen(false);
    void loadData();
  };

  const handleToggleStatus = (contract: Contract) => {
    if (!canManage) {
      showError(t("common.noPermission"));
      return;
    }
    setCancelTarget(contract);
  };

  const handleConfirmCancel = async () => {
    if (!cancelTarget) return;
    setDeleting(true);
    const nextStatus: ContractStatus =
      cancelTarget.status === "cancelled" ? "active" : "cancelled";
    const result = await updateContract(cancelTarget.id, { status: nextStatus });
    setDeleting(false);
    if (!result.ok) {
      showError(result.error);
      return;
    }
    showSuccess(t("common.success"));
    setCancelTarget(null);
    setContracts((rows) =>
      rows.map((row) => (row.id === cancelTarget.id ? result.contract : row))
    );
  };

  const handleDeleteContract = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await deleteContractAction(deleteTarget.id);
    setDeleting(false);
    if (!result.success) {
      showError(result.error || t("common.error"));
      return;
    }
    setDeleteTarget(null);
    showSuccess(t("official.deleteSuccess"));
    void loadData();
  };

  const handlePrint = (contract: Contract) => {
    setPrintData({ contract, branding });
  };

  const handleAttachmentUploaded = (updated: Contract) => {
    setContracts((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
    showSuccess(t("common.success"));
  };

  const typeTabLabel = (tab: "all" | ContractType) => {
    if (tab === "all") return t("common.all");
    return getContractTypeLabel(tab, t);
  };

  const statusTabLabel = (tab: "all" | ContractStatus) => {
    if (tab === "all") return t("official.filterStatusAll");
    return getContractStatusLabel(tab, t);
  };

  return (
    <PageLayout title={t("official.contractsPageTitle")}>
      <div className="space-y-4">
        <ContractStatsCards contracts={contracts} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2 top-2 h-4 w-4 text-app-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("official.searchContractsPlaceholder")}
              className="app-input w-full pl-8"
            />
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void loadData()} className="btn-secondary p-2">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            {canManage && (
              <button type="button" onClick={openCreate} className="btn-primary flex items-center gap-1">
                <Plus className="h-4 w-4" />
                {t("official.newContract")}
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {TYPE_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilterType(tab)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                filterType === tab
                  ? "bg-app-accent text-white"
                  : "bg-app-card-hover text-app-muted hover:text-app"
              }`}
            >
              {typeTabLabel(tab)}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilterStatus(tab)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                filterStatus === tab
                  ? "border border-app-accent bg-app-accent/10 text-app-accent"
                  : "border border-app bg-app-card-hover text-app-muted hover:text-app"
              }`}
            >
              {statusTabLabel(tab)}
            </button>
          ))}
        </div>

        <div className="app-card overflow-hidden">
          {loading ? (
            <p className="p-6 text-center text-sm text-app-muted">{t("common.loading")}</p>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-center text-sm text-app-muted">{t("common.noData")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-xs">
                <thead className="border-b border-app bg-app-card-hover text-left text-app-muted">
                  <tr>
                    <th className="px-4 py-2">{t("official.contractNumber")}</th>
                    <th className="px-4 py-2">{t("official.contractTitle")}</th>
                    <th className="px-4 py-2">{t("official.contractType")}</th>
                    <th className="px-4 py-2">{t("official.party")}</th>
                    <th className="px-4 py-2 text-right">{t("official.contractAmount")}</th>
                    <th className="px-4 py-2">{t("official.paymentTerms")}</th>
                    <th className="px-4 py-2">{t("common.status")}</th>
                    <th className="px-4 py-2 text-right">{t("common.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id} className="border-b border-app/50 hover:bg-app-card-hover">
                      <td className="px-4 py-2 font-mono">{c.contract_number}</td>
                      <td className="px-4 py-2">{c.title}</td>
                      <td className="px-4 py-2">{getContractTypeLabel(c.type, t)}</td>
                      <td className="px-4 py-2">
                        <div>{c.party_name || "—"}</div>
                        {c.voen && (
                          <div className="text-[10px] text-app-muted">VÖEN: {c.voen}</div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-mono">
                        {c.total_amount != null ? Number(c.total_amount).toFixed(2) : "—"}
                      </td>
                      <td className="px-4 py-2 text-app-muted">
                        {formatContractOptionLabel(c, t).split(" - ").slice(1).join(" - ") || "—"}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            c.status === "active"
                              ? "bg-emerald-500/10 text-emerald-600"
                              : c.status === "completed"
                                ? "bg-blue-500/10 text-blue-600"
                                : "bg-rose-500/10 text-rose-600"
                          }`}
                        >
                          {getContractStatusLabel(c.status, t)}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center justify-end gap-0.5">
                          <button
                            type="button"
                            onClick={() => handlePrint(c)}
                            className="rounded p-1.5 hover:bg-app-card-hover"
                            title={t("official.printContract")}
                          >
                            <Printer className="h-4 w-4" />
                          </button>
                          {canManage && (
                            <ContractAttachmentButton
                              contract={c}
                              disabled={!canManage}
                              onUploaded={handleAttachmentUploaded}
                              onError={showError}
                            />
                          )}
                          <button
                            type="button"
                            onClick={() => setLinkedContract(c)}
                            className="rounded p-1.5 hover:bg-app-card-hover"
                            title={t("official.linkedInvoices")}
                          >
                            <FileText className="h-4 w-4" />
                          </button>
                          {canManage && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEdit(c)}
                                className="rounded p-1.5 hover:bg-app-card-hover"
                                title={t("official.editContract")}
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleStatus(c)}
                                className="rounded p-1.5 text-rose-500 hover:bg-rose-500/10"
                                title={
                                  c.status === "cancelled"
                                    ? t("official.reactivateContract")
                                    : t("official.cancelContract")
                                }
                              >
                                <Ban className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(c)}
                                className="rounded p-1.5 text-rose-600 hover:bg-rose-500/10"
                                title={t("common.delete")}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center app-scrim p-4">
          <div className="app-modal max-h-[90vh] w-full max-w-lg overflow-y-auto">
            <div className="flex items-center justify-between border-b border-app px-5 py-4">
              <h3 className="font-bold">
                {editingId ? t("official.editContract") : t("official.newContract")}
              </h3>
              <button type="button" onClick={() => setModalOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3 p-5 text-xs">
              <label className="block space-y-1">
                <span className="font-semibold">{t("official.contractType")}</span>
                <select
                  value={form.type}
                  onChange={(e) => {
                    const nextType = e.target.value as ContractType;
                    setForm((f) => ({
                      ...f,
                      type: nextType,
                      party_id: "",
                      contract_number: generateContractNumber(nextType),
                    }));
                  }}
                  className="app-input w-full"
                >
                  <option value="sale">{t("official.typeSale")}</option>
                  <option value="purchase">{t("official.typePurchase")}</option>
                  <option value="service">{t("official.typeService")}</option>
                </select>
              </label>

              <label className="block space-y-1">
                <span className="font-semibold">{t("official.contractNumber")}</span>
                <input
                  type="text"
                  value={form.contract_number}
                  onChange={(e) => setForm((f) => ({ ...f, contract_number: e.target.value }))}
                  className="app-input w-full"
                  required
                />
              </label>

              <label className="block space-y-1">
                <span className="font-semibold">{t("official.party")}</span>
                {partyOptions.length === 0 ? (
                  <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-700">
                    {t("official.noLegalParties")}
                  </p>
                ) : (
                  <select
                    value={form.party_id}
                    onChange={(e) => setForm((f) => ({ ...f, party_id: e.target.value }))}
                    className="app-input w-full"
                    required
                  >
                    <option value="">{t("common.select")}</option>
                    {partyOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.voen ? `(VÖEN: ${p.voen})` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </label>

              <label className="block space-y-1">
                <span className="font-semibold">{t("official.contractTitle")}</span>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className="app-input w-full"
                  required
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="font-semibold">{t("official.contractDate")}</span>
                  <input
                    type="date"
                    value={form.contract_date}
                    onChange={(e) => setForm((f) => ({ ...f, contract_date: e.target.value }))}
                    className="app-input w-full"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="font-semibold">{t("official.expiryDate")}</span>
                  <input
                    type="date"
                    value={form.expiry_date}
                    onChange={(e) => setForm((f) => ({ ...f, expiry_date: e.target.value }))}
                    className="app-input w-full"
                  />
                </label>
              </div>

              <div className="rounded-lg border border-app bg-app-card-hover p-3 space-y-3">
                <p className="font-semibold text-app">{t("official.paymentTerms")}</p>
                <label className="block space-y-1">
                  <span className="font-semibold">{t("official.advancePercentage")}</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={form.advance_percentage}
                    onChange={(e) => setForm((f) => ({ ...f, advance_percentage: e.target.value }))}
                    className="app-input w-full"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="font-semibold">{t("official.paymentStages")}</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={form.payment_stages}
                    onChange={(e) => setForm((f) => ({ ...f, payment_stages: e.target.value }))}
                    className="app-input w-full"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="font-semibold">
                    {t("official.contractAmount")} ({t("official.optional")})
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.total_amount}
                    onChange={(e) => setForm((f) => ({ ...f, total_amount: e.target.value }))}
                    className="app-input w-full"
                  />
                </label>
              </div>

              <label className="block space-y-1">
                <span className="font-semibold">{t("official.paymentTermsNotes")}</span>
                <textarea
                  value={form.payment_terms_notes}
                  onChange={(e) => setForm((f) => ({ ...f, payment_terms_notes: e.target.value }))}
                  rows={3}
                  className="app-input w-full resize-none"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="font-semibold">{t("common.status")}</span>
                  <select
                    value={form.status}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, status: e.target.value as ContractStatus }))
                    }
                    className="app-input w-full"
                  >
                    <option value="active">{t("official.statusActive")}</option>
                    <option value="completed">{t("official.statusCompleted")}</option>
                    <option value="cancelled">{t("official.statusCancelled")}</option>
                  </select>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={saving || partyOptions.length === 0}
                  className="btn-primary"
                >
                  {saving ? t("common.saving") : t("common.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {linkedContract && (
        <ContractLinkedInvoicesModal
          contract={linkedContract}
          onClose={() => setLinkedContract(null)}
        />
      )}

      {printData && (
        <div className="print-area">
          <ContractPrintTemplate data={printData} />
        </div>
      )}

      <ConfirmDeleteModal
        open={Boolean(cancelTarget)}
        title={
          cancelTarget?.status === "cancelled"
            ? t("official.reactivateContract")
            : t("official.cancelContract")
        }
        message={t("official.cancelConfirmMessage")}
        itemName={cancelTarget?.contract_number}
        confirmLabel={
          cancelTarget?.status === "cancelled"
            ? t("official.reactivateContract")
            : t("official.cancelContract")
        }
        loading={deleting}
        onConfirm={() => void handleConfirmCancel()}
        onCancel={() => setCancelTarget(null)}
      />

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        itemName={deleteTarget?.contract_number}
        loading={deleting}
        onConfirm={() => void handleDeleteContract()}
        onCancel={() => setDeleteTarget(null)}
      />

      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}
