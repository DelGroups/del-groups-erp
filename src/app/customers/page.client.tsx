"use client";
import PageLayout from "@/components/layout/PageLayout";
import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import type { Customer } from "@/types/database.types";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import {
  Plus,
  Pencil,
  Search,
  RefreshCw,
  X,
  Phone,
} from "lucide-react";

export default function CustomersPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const canManageCustomers = can("can_manage_customers");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { message: toastMessage, variant: toastVariant, showError } = useToast();

  // Form State
  const [formData, setFormData] = useState({
    code: "",
    full_name: "",
    phone: "",
    company_name: "",
  });
  const [viewBalance, setViewBalance] = useState(0);

  const fetchCustomers = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Xəta baş verdi:", error.message);
    } else {
      setCustomers(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    void fetchCustomers();
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const newCustomer = {
      code: formData.code || `CUST-${Math.floor(1000 + Math.random() * 9000)}`,
      full_name: formData.full_name,
      phone: formData.phone,
      company_name: formData.company_name,
    };

    const isEdit = Boolean(editingCustomerId);
    const { data, error } = isEdit
      ? await supabase
          .from("customers")
          .update(newCustomer)
          .eq("id", editingCustomerId)
          .select("*")
          .single()
      : await supabase
          .from("customers")
          .insert([{ ...newCustomer, balance: 0 }])
          .select("*")
          .single();

    if (error) {
      showError(t("common.errorOccurred", { message: error.message }));
    } else {
      const row = data as Customer;
      setCustomers((prev) =>
        isEdit ? prev.map((item) => (item.id === row.id ? row : item)) : [row, ...prev]
      );
      setIsModalOpen(false);
      setEditingCustomerId(null);
      setFormData({
        code: "",
        full_name: "",
        phone: "",
        company_name: "",
      });
      setViewBalance(0);
    }
    setSaving(false);
  };

  const openCreateModal = () => {
    if (!canManageCustomers) return;
    setEditingCustomerId(null);
    setViewBalance(0);
    setFormData({
      code: "",
      full_name: "",
      phone: "",
      company_name: "",
    });
    setIsModalOpen(true);
  };

  const openEditModal = (customer: Customer) => {
    if (!canManageCustomers) return;
    setEditingCustomerId(customer.id);
    setViewBalance(customer.balance ?? 0);
    setFormData({
      code: customer.code || "",
      full_name: customer.full_name || "",
      phone: customer.phone || "",
      company_name: customer.company_name || "",
    });
    setIsModalOpen(true);
  };

  const filteredCustomers = customers.filter(
    (c) =>
      c.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.company_name && c.company_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (c.code && c.code.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <PageLayout>
        <header className="flex items-center justify-between border-b border-app app-glass px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-app">{t("customers.title")}</h2>
            <p className="text-sm text-app-muted">{t("customers.pageDescription")}</p>
          </div>
          <button
            onClick={openCreateModal}
            className="btn-primary disabled:opacity-50"
            disabled={!canManageCustomers}
          >
            <Plus className="w-4 h-4" />
            <span>{t("customers.createButton")}</span>
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="app-card app-card-elevated flex flex-col items-center justify-between gap-4 p-4 sm:flex-row">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 absolute left-3 top-3 text-app-muted" />
              <input
                type="text"
                placeholder={t("customers.searchPlaceholder")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="app-input pl-9"
              />
            </div>
            <button
              onClick={fetchCustomers}
              className="p-2 border border-app rounded-lg text-app-muted hover:bg-app-card-hover"
              title={t("common.refresh")}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          <div className="app-table-wrap">
            {loading ? (
              <div className="p-8 text-center text-app-muted text-sm">{t("common.loading")}</div>
            ) : filteredCustomers.length === 0 ? (
              <div className="p-8 text-center text-app-muted text-sm">
                {t("customers.emptyHint")}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="app-table">
                  <thead>
                    <tr>
                      <th className="px-6 py-3">{t("common.code")}</th>
                      <th className="px-6 py-3">{t("customers.customerCompany")}</th>
                      <th className="px-6 py-3">{t("common.phone")}</th>
                      <th className="px-6 py-3">{t("customers.balanceDebt")}</th>
                      {canManageCustomers ? <th className="px-6 py-3">{t("common.actions")}</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCustomers.map((c) => {
                      const isDebtor = (c.balance ?? 0) > 0;
                      return (
                        <tr key={c.id} >
                          <td className="px-6 py-4 font-mono text-xs font-semibold text-app">
                            {c.code}
                          </td>
                          <td className="px-6 py-4">
                            <div className="font-medium text-app">{c.full_name}</div>
                            {c.company_name && (
                              <div className="text-xs text-app-muted">{c.company_name}</div>
                            )}
                          </td>
                          <td className="px-6 py-4 text-app-muted">
                            {c.phone ? (
                              <span className="flex items-center space-x-1">
                                <Phone className="w-3.5 h-3.5 text-app-muted mr-1" />
                                {c.phone}
                              </span>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td className="px-6 py-4 font-bold">
                            {isDebtor ? (
                              <span className="text-amber-600">{(c.balance ?? 0).toFixed(2)} AZN ({t("common.debtor")})</span>
                            ) : (
                              <span className="text-emerald-600">{(c.balance ?? 0).toFixed(2)} AZN</span>
                            )}
                          </td>
                          {canManageCustomers ? (
                            <td className="px-6 py-4">
                              <button
                                type="button"
                                onClick={() => openEditModal(c)}
                                className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                {t("common.edit")}
                              </button>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>

      {/* Modal Add Customer */}
      {isModalOpen && (
        <div className="app-modal-overlay">
          <div className="app-modal w-full max-w-md">
            <div className="app-modal-header flex justify-between items-center">
              <h3 className="font-bold text-app">
                {editingCustomerId ? t("common.edit") : t("customers.addModalTitle")}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-app-muted hover:text-app-muted">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-app mb-1">{t("customers.customerCode")}</label>
                <input
                  type="text"
                  name="code"
                  placeholder={t("customers.customerCodePlaceholder")}
                  value={formData.code}
                  onChange={handleInputChange}
                  className="app-input"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-app mb-1">{t("customers.fullNameRequired")}</label>
                <input
                  type="text"
                  name="full_name"
                  required
                  placeholder={t("customers.fullNamePlaceholder")}
                  value={formData.full_name}
                  onChange={handleInputChange}
                  className="app-input"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-app mb-1">{t("common.companyName")}</label>
                <input
                  type="text"
                  name="company_name"
                  placeholder={t("customers.companyPlaceholder")}
                  value={formData.company_name}
                  onChange={handleInputChange}
                  className="app-input"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-app mb-1">{t("common.contactPhone")}</label>
                <input
                  type="text"
                  name="phone"
                  placeholder={t("customers.phonePlaceholder")}
                  value={formData.phone}
                  onChange={handleInputChange}
                  className="app-input"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-app mb-1">
                  {t("customers.balanceDebt")}
                </label>
                <div className="app-input bg-app-card-hover text-app-muted cursor-not-allowed">
                  {editingCustomerId
                    ? `${viewBalance.toFixed(2)} AZN`
                    : t("customers.balanceComputedHint")}
                </div>
                <p className="mt-1 text-[11px] text-app-muted">{t("customers.balanceReadOnlyHint")}</p>
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
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}
