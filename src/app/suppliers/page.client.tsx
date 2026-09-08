"use client";
import PageLayout from "@/components/layout/PageLayout";
import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import type { Supplier } from "@/types/database.types";
import type { EntityType } from "@/lib/customers/entityType";
import { entityTypeLabel } from "@/lib/customers/entityType";
import {
  Plus,
  Pencil,
  Search,
  RefreshCw,
  X,
  Phone,
  Trash2,
} from "lucide-react";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import { deleteSupplierAction } from "@/lib/actions/entityDelete";

export default function SuppliersPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const canManageSuppliers = can("can_manage_suppliers");
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    code: "",
    full_name: "",
    phone: "",
    company_name: "",
    address: "",
    voen: "",
    entity_type: "physical" as EntityType,
    balance: "0.00",
  });

  const fetchSuppliers = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("suppliers")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Xəta baş verdi:", error.message);
    } else {
      setSuppliers(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    void fetchSuppliers();
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const newSupplier = {
      code: formData.code || `SUP-${Math.floor(1000 + Math.random() * 9000)}`,
      full_name: formData.full_name,
      phone: formData.phone,
      company_name: formData.company_name,
      address: formData.address,
      voen: formData.entity_type === "legal" ? formData.voen.trim() : formData.voen.trim() || null,
      entity_type: formData.entity_type,
      balance: parseFloat(formData.balance) || 0,
    };

    if (formData.entity_type === "legal" && !formData.voen.trim()) {
      showError(t("customers.voenRequiredForLegal"));
      setSaving(false);
      return;
    }

    const isEdit = Boolean(editingSupplierId);
    const { data, error } = isEdit
      ? await supabase
          .from("suppliers")
          .update(newSupplier)
          .eq("id", editingSupplierId)
          .select("*")
          .single()
      : await supabase.from("suppliers").insert([newSupplier]).select("*").single();

    if (error) {
      showError(t("common.errorOccurred", { message: error.message }));
    } else {
      const row = data as Supplier;
      setSuppliers((prev) =>
        isEdit ? prev.map((item) => (item.id === row.id ? row : item)) : [row, ...prev]
      );
      setIsModalOpen(false);
      setEditingSupplierId(null);
      setFormData({
        code: "",
        full_name: "",
        phone: "",
        company_name: "",
        address: "",
        voen: "",
        entity_type: "physical",
        balance: "0.00",
      });
    }
    setSaving(false);
  };

  const handleDeleteSupplier = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await deleteSupplierAction(deleteTarget.id);
    setDeleting(false);
    if (!result.success) {
      showError(result.error || t("common.error"));
      return;
    }
    setDeleteTarget(null);
    showSuccess(t("suppliers.deleteSuccess"));
    void fetchSuppliers();
  };

  const openCreateModal = () => {
    if (!canManageSuppliers) return;
    setEditingSupplierId(null);
    setFormData({
      code: "",
      full_name: "",
      phone: "",
      company_name: "",
      address: "",
      voen: "",
      entity_type: "physical",
      balance: "0.00",
    });
    setIsModalOpen(true);
  };

  const openEditModal = (supplier: Supplier) => {
    if (!canManageSuppliers) return;
    setEditingSupplierId(supplier.id);
    setFormData({
      code: supplier.code || "",
      full_name: supplier.full_name || "",
      phone: supplier.phone || "",
      company_name: supplier.company_name || "",
      address: supplier.address || "",
      voen: supplier.voen || "",
      entity_type: supplier.entity_type === "legal" ? "legal" : "physical",
      balance: String(supplier.balance ?? 0),
    });
    setIsModalOpen(true);
  };

  const filteredSuppliers = suppliers.filter(
    (s) =>
      (s.full_name ?? "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.company_name && s.company_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (s.code && s.code.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <PageLayout>
        <header className="flex items-center justify-between border-b border-app app-glass px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-app">{t("suppliers.pageTitle")}</h2>
            <p className="text-sm text-app-muted">{t("suppliers.pageDescription")}</p>
          </div>
          <button
            onClick={openCreateModal}
            className="btn-primary disabled:opacity-50"
            disabled={!canManageSuppliers}
          >
            <Plus className="w-4 h-4" />
            <span>{t("suppliers.createButton")}</span>
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="app-card app-card-elevated flex flex-col items-center justify-between gap-4 p-4 sm:flex-row">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 absolute left-3 top-3 text-app-muted" />
              <input
                type="text"
                placeholder={t("suppliers.searchPlaceholder")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="app-input pl-9"
              />
            </div>
            <button
              onClick={fetchSuppliers}
              className="p-2 border border-app rounded-lg text-app-muted hover:bg-app-card-hover"
              title={t("common.refresh")}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          <div className="app-table-wrap">
            {loading ? (
              <div className="p-8 text-center text-app-muted text-sm">{t("common.loading")}</div>
            ) : filteredSuppliers.length === 0 ? (
              <div className="p-8 text-center text-app-muted text-sm">
                {t("suppliers.emptyHint")}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="app-table">
                  <thead>
                    <tr>
                      <th className="px-6 py-3">{t("common.code")}</th>
                      <th className="px-6 py-3">{t("suppliers.supplierCompany")}</th>
                      <th className="px-6 py-3">{t("common.phone")}</th>
                      <th className="px-6 py-3">{t("suppliers.ourDebt")}</th>
                      {canManageSuppliers ? <th className="px-6 py-3">{t("common.actions")}</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSuppliers.map((s) => (
                      <tr key={s.id} >
                        <td className="px-6 py-4 font-mono text-xs font-semibold text-app">
                          {s.code}
                        </td>
                        <td className="px-6 py-4">
                          <div className="font-medium text-app">{s.full_name}</div>
                          {s.company_name && (
                            <div className="text-xs text-app-muted">{s.company_name}</div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-app-muted">
                          {s.phone ? (
                            <span className="flex items-center space-x-1">
                              <Phone className="w-3.5 h-3.5 text-app-muted mr-1" />
                              {s.phone}
                            </span>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="px-6 py-4 font-bold">
                          {(s.balance ?? 0) > 0 ? (
                            <span className="text-rose-600">{(s.balance ?? 0).toFixed(2)} AZN ({t("common.weOwe")})</span>
                          ) : (
                            <span className="text-emerald-600">{(s.balance ?? 0).toFixed(2)} AZN</span>
                          )}
                        </td>
                        {canManageSuppliers ? (
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => openEditModal(s)}
                                className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                {t("common.edit")}
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(s)}
                                className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                {t("common.delete")}
                              </button>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>

      {/* Modal Add Supplier */}
      {isModalOpen && (
        <div className="app-modal-overlay">
          <div className="app-modal w-full max-w-md">
            <div className="app-modal-header flex justify-between items-center">
              <h3 className="font-bold text-app">
                {editingSupplierId ? t("common.edit") : t("suppliers.addModalTitle")}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-app-muted hover:text-app-muted">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-app mb-2">
                  {t("customers.entityType")}
                </label>
                <div className="inline-flex overflow-hidden rounded-lg border border-app">
                  <button
                    type="button"
                    onClick={() => setFormData((f) => ({ ...f, entity_type: "physical" }))}
                    className={`px-3 py-1.5 text-xs font-semibold ${
                      formData.entity_type === "physical"
                        ? "bg-slate-600 text-white"
                        : "bg-app-card text-app-muted"
                    }`}
                  >
                    {t("customers.entityPhysical")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData((f) => ({ ...f, entity_type: "legal" }))}
                    className={`px-3 py-1.5 text-xs font-semibold ${
                      formData.entity_type === "legal"
                        ? "bg-emerald-600 text-white"
                        : "bg-app-card text-app-muted"
                    }`}
                  >
                    {t("customers.entityLegal")}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-app mb-1">{t("suppliers.codeOptional")}</label>
                <input
                  type="text"
                  name="code"
                  placeholder={t("suppliers.codePlaceholder")}
                  value={formData.code}
                  onChange={handleInputChange}
                  className="app-input"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-app mb-1">{t("suppliers.contactPerson")}</label>
                <input
                  type="text"
                  name="full_name"
                  required
                  placeholder={t("suppliers.contactPlaceholder")}
                  value={formData.full_name}
                  onChange={handleInputChange}
                  className="app-input"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-app mb-1">
                  {t("common.companyName")}
                  {formData.entity_type === "legal" ? " *" : ""}
                </label>
                <input
                  type="text"
                  name="company_name"
                  required={formData.entity_type === "legal"}
                  placeholder={t("suppliers.companyPlaceholder")}
                  value={formData.company_name}
                  onChange={handleInputChange}
                  className="app-input"
                />
              </div>

              {formData.entity_type === "legal" && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-app mb-1">
                      {t("invoice.voen")} *
                    </label>
                    <input
                      type="text"
                      name="voen"
                      required
                      value={formData.voen}
                      onChange={handleInputChange}
                      className="app-input"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-app mb-1">
                      {t("invoice.addressLabel")}
                    </label>
                    <input
                      type="text"
                      name="address"
                      value={formData.address}
                      onChange={handleInputChange}
                      className="app-input"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs font-medium text-app mb-1">{t("common.contactPhone")}</label>
                <input
                  type="text"
                  name="phone"
                  placeholder={t("suppliers.phonePlaceholder")}
                  value={formData.phone}
                  onChange={handleInputChange}
                  className="app-input"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-app mb-1">{t("suppliers.initialDebt")}</label>
                <input
                  type="number"
                  step="0.01"
                  name="balance"
                  value={formData.balance}
                  onChange={handleInputChange}
                  className="app-input"
                />
              </div>

              <div className="pt-3 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-app rounded-lg text-xs font-semibold text-app hover:bg-app-card-hover"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary disabled:opacity-50"
                >
                  {saving ? t("common.saving") : t("common.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        itemName={deleteTarget?.full_name}
        loading={deleting}
        onConfirm={() => void handleDeleteSupplier()}
        onCancel={() => setDeleteTarget(null)}
      />
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}
