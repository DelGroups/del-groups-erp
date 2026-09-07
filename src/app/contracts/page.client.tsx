"use client";

import React, { useEffect, useMemo, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import { Plus, Pencil, RefreshCw, Search, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import {
  createContract,
  fetchContracts,
  formatContractOptionLabel,
  generateContractNumber,
  getContractTypeLabel,
  updateContract,
  type Contract,
  type ContractStatus,
  type ContractType,
} from "@/lib/contracts/api";
import { filterLegalCustomers, filterLegalSuppliers } from "@/lib/customers/entityType";
import { supabase } from "@/lib/supabase";
import type { Customer, Supplier } from "@/types/database.types";

export default function ContractsPageClient() {
  const { t } = useI18n();
  const { can } = useAuth();
  const canManage = can("can_create_invoice") || can("can_view_purchases");
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();

  const [contracts, setContracts] = useState<Contract[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"all" | ContractType>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
    const [contractRows, customerRes, supplierRes] = await Promise.all([
      fetchContracts(),
      supabase.from("customers").select("*").order("full_name"),
      supabase.from("suppliers").select("*").order("full_name"),
    ]);

    setContracts(contractRows);
    setCustomers((customerRes.data as Customer[]) || []);
    setSuppliers((supplierRes.data as Supplier[]) || []);
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
      if (!term) return true;
      return (
        c.contract_number.toLowerCase().includes(term) ||
        c.title.toLowerCase().includes(term) ||
        (c.party_name || "").toLowerCase().includes(term)
      );
    });
  }, [contracts, search, filterType]);

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

  return (
    <PageLayout title={t("official.contractsPageTitle")}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-2 h-4 w-4 text-app-muted" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("common.search")}
                className="app-input pl-8"
              />
            </div>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as "all" | ContractType)}
              className="app-input"
            >
              <option value="all">{t("common.all")}</option>
              <option value="sale">{t("official.typeSale")}</option>
              <option value="purchase">{t("official.typePurchase")}</option>
              <option value="service">{t("official.typeService")}</option>
            </select>
            <button type="button" onClick={() => void loadData()} className="btn-secondary p-2">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          {canManage && (
            <button type="button" onClick={openCreate} className="btn-primary flex items-center gap-1">
              <Plus className="h-4 w-4" />
              {t("official.newContract")}
            </button>
          )}
        </div>

        <div className="app-card overflow-hidden">
          {loading ? (
            <p className="p-6 text-center text-sm text-app-muted">{t("common.loading")}</p>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-center text-sm text-app-muted">{t("common.noData")}</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="border-b border-app bg-app-card-hover text-left text-app-muted">
                <tr>
                  <th className="px-4 py-2">{t("official.contractNumber")}</th>
                  <th className="px-4 py-2">{t("official.contractTitle")}</th>
                  <th className="px-4 py-2">{t("official.contractType")}</th>
                  <th className="px-4 py-2">{t("official.party")}</th>
                  <th className="px-4 py-2 text-right">{t("official.contractAmount")}</th>
                  <th className="px-4 py-2">{t("official.paymentTerms")}</th>
                  <th className="px-4 py-2">{t("common.status")}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="border-b border-app/50 hover:bg-app-card-hover">
                    <td className="px-4 py-2 font-mono">{c.contract_number}</td>
                    <td className="px-4 py-2">{c.title}</td>
                    <td className="px-4 py-2">{getContractTypeLabel(c.type, t)}</td>
                    <td className="px-4 py-2">{c.party_name || "-"}</td>
                    <td className="px-4 py-2 text-right font-mono">
                      {c.total_amount != null ? Number(c.total_amount).toFixed(2) : "—"}
                    </td>
                    <td className="px-4 py-2 text-app-muted">
                      {formatContractOptionLabel(c, t).split(" - ").slice(1).join(" - ") || "—"}
                    </td>
                    <td className="px-4 py-2">{c.status}</td>
                    <td className="px-4 py-2 text-right">
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => openEdit(c)}
                          className="rounded p-1 hover:bg-app-card"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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

      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}
