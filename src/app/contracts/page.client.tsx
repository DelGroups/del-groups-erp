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
  generateContractNumber,
  updateContract,
  type Contract,
  type ContractStatus,
  type ContractType,
} from "@/lib/contracts/api";
import { supabase } from "@/lib/supabase";

interface PartyOption {
  id: string;
  name: string;
  voen?: string | null;
}

export default function ContractsPageClient() {
  const { t } = useI18n();
  const { can } = useAuth();
  const canManage = can("can_create_invoice") || can("can_view_purchases");
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();

  const [contracts, setContracts] = useState<Contract[]>([]);
  const [customers, setCustomers] = useState<PartyOption[]>([]);
  const [suppliers, setSuppliers] = useState<PartyOption[]>([]);
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
    voen: "",
  });

  const loadData = async () => {
    setLoading(true);
    const [contractRows, customerRes, supplierRes] = await Promise.all([
      fetchContracts(),
      supabase.from("customers").select("id, full_name, name, voen").order("full_name"),
      supabase.from("suppliers").select("id, name, voen").order("name"),
    ]);

    setContracts(contractRows);
    setCustomers(
      (customerRes.data || []).map((c) => ({
        id: c.id,
        name: c.full_name || c.name || "-",
        voen: c.voen,
      }))
    );
    setSuppliers(
      (supplierRes.data || []).map((s) => ({
        id: s.id,
        name: s.name || "-",
        voen: s.voen,
      }))
    );
    setLoading(false);
  };

  useEffect(() => {
    void loadData();
  }, []);

  const partyOptions = form.type === "sale" ? customers : suppliers;

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

  const openCreate = () => {
    setEditingId(null);
    setForm({
      contract_number: generateContractNumber("sale"),
      type: "sale",
      party_id: "",
      title: "",
      total_amount: "",
      status: "active",
      voen: "",
    });
    setModalOpen(true);
  };

  const openEdit = (contract: Contract) => {
    setEditingId(contract.id);
    setForm({
      contract_number: contract.contract_number,
      type: contract.type,
      party_id: contract.party_id,
      title: contract.title,
      total_amount: String(contract.total_amount || 0),
      status: contract.status,
      voen: contract.voen || "",
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
    setSaving(true);
    const payload = {
      contract_number: form.contract_number.trim(),
      party_id: form.party_id,
      party_name: party?.name ?? null,
      type: form.type,
      title: form.title.trim(),
      total_amount: Number(form.total_amount) || 0,
      status: form.status,
      voen: form.voen.trim() || null,
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
                  <th className="px-4 py-2">{t("common.status")}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="border-b border-app/50 hover:bg-app-card-hover">
                    <td className="px-4 py-2 font-mono">{c.contract_number}</td>
                    <td className="px-4 py-2">{c.title}</td>
                    <td className="px-4 py-2">
                      {c.type === "sale" ? t("official.typeSale") : t("official.typePurchase")}
                    </td>
                    <td className="px-4 py-2">{c.party_name || "-"}</td>
                    <td className="px-4 py-2 text-right font-mono">
                      {Number(c.total_amount || 0).toFixed(2)}
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
          <div className="app-modal w-full max-w-lg">
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
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      type: e.target.value as ContractType,
                      party_id: "",
                      contract_number: generateContractNumber(e.target.value as ContractType),
                    }))
                  }
                  className="app-input w-full"
                >
                  <option value="sale">{t("official.typeSale")}</option>
                  <option value="purchase">{t("official.typePurchase")}</option>
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
                <select
                  value={form.party_id}
                  onChange={(e) => {
                    const id = e.target.value;
                    const party = partyOptions.find((p) => p.id === id);
                    setForm((f) => ({
                      ...f,
                      party_id: id,
                      voen: party?.voen || f.voen,
                    }));
                  }}
                  className="app-input w-full"
                  required
                >
                  <option value="">{t("common.select")}</option>
                  {partyOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
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
                  <span className="font-semibold">{t("official.contractAmount")}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.total_amount}
                    onChange={(e) => setForm((f) => ({ ...f, total_amount: e.target.value }))}
                    className="app-input w-full"
                  />
                </label>
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

              <label className="block space-y-1">
                <span className="font-semibold">{t("invoice.voen")}</span>
                <input
                  type="text"
                  value={form.voen}
                  onChange={(e) => setForm((f) => ({ ...f, voen: e.target.value }))}
                  className="app-input w-full"
                />
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">
                  {t("common.cancel")}
                </button>
                <button type="submit" disabled={saving} className="btn-primary">
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
