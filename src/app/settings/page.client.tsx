"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import PageLayout from "@/components/layout/PageLayout";
import PermissionGuard from "@/components/auth/PermissionGuard";
import SettingsTabs from "@/components/settings/SettingsTabs";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import {
  Settings, 
  Building2, 
  Save, 
  Percent, 
  CreditCard, 
  Phone, 
  Mail, 
  MapPin, 
  CheckCircle2 
} from "lucide-react";

export default function SettingsPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [recordId, setRecordId] = useState<string | null>(null);

  const [companyName, setCompanyName] = useState("Del Groups MMC");
  const [voen, setVoen] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [bankName, setBankName] = useState("");
  const [iban, setIban] = useState("");
  const [vatRate, setVatRate] = useState("18");
  const [currency, setCurrency] = useState("AZN");

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("company_settings")
      .select("*")
      .limit(1)
      .single();

    if (data && !error) {
      setRecordId(data.id);
      setCompanyName(data.company_name || "Del Groups MMC");
      setVoen(data.voen || "");
      setAddress(data.address || "");
      setPhone(data.phone || "");
      setEmail(data.email || "");
      setBankName(data.bank_name || "");
      setIban(data.iban || "");
      setVatRate(data.vat_rate?.toString() || "18");
      setCurrency(data.currency || "AZN");
    }
    setLoading(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSuccessMsg("");

    const payload = {
      company_name: companyName,
      voen,
      address,
      phone,
      email,
      bank_name: bankName,
      iban,
      vat_rate: parseFloat(vatRate) || 18,
      currency,
    };

    let error;
    if (recordId) {
      const res = await supabase
        .from("company_settings")
        .update(payload)
        .eq("id", recordId);
      error = res.error;
    } else {
      const res = await supabase.from("company_settings").insert([payload]);
      error = res.error;
    }

    if (!error) {
      setSuccessMsg(t("settings.saveSuccess"));
      setTimeout(() => setSuccessMsg(""), 4000);
      fetchSettings();
    } else {
      alert(t("common.errorOccurred", { message: error.message }));
    }
    setSaving(false);
  };

  return (
    <PageLayout>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-app bg-app-surface px-6 py-4 backdrop-blur-md">
          <div>
            <h1 className="text-xl font-bold text-app flex items-center gap-2">
              <Settings className="w-6 h-6 text-app-accent" />
              {t("settings.pageTitle")}
            </h1>
            <p className="text-xs text-app-muted mt-0.5">
              {t("settings.pageDescription")}
            </p>
          </div>
        </div>

        <SettingsTabs activeTab="company" />

        {/* Content */}
        <PermissionGuard permission="can_view_settings">
        <div className="p-6 max-w-5xl space-y-6">
          {successMsg && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-xl flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              {successMsg}
            </div>
          )}

          {loading ? (
            <div className="p-12 text-center text-xs text-app-muted">
              {t("common.dataLoading")} {t("common.pleaseWait")}
            </div>
          ) : (
            <form onSubmit={handleSave} className="space-y-6">
              {/* Company Info Card */}
              <div className="app-card app-card-elevated p-6 space-y-4">
                <h2 className="text-sm font-bold text-app flex items-center gap-2 pb-2 border-b border-app">
                  <Building2 className="w-4 h-4 text-app-accent" />
                  {t("settings.companyOfficial")}
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-app mb-1">
                      {t("settings.companyName")}
                    </label>
                    <input
                      type="text"
                      required
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      className="app-input"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-app mb-1">
                      {t("settings.voen")}
                    </label>
                    <input
                      type="text"
                      value={voen}
                      onChange={(e) => setVoen(e.target.value)}
                      placeholder={t("settings.voenPlaceholder")}
                      className="app-input font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-app mb-1">
                      {t("settings.phoneNumber")}
                    </label>
                    <div className="relative">
                      <Phone className="w-4 h-4 absolute left-3 top-2.5 text-app-muted" />
                      <input
                        type="text"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+994 50 000 00 00"
                        className="w-full pl-9 pr-3 py-2 border border-app rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--app-accent-ring)]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-app mb-1">
                      {t("settings.emailAddress")}
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 absolute left-3 top-2.5 text-app-muted" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="info@delgroups.az"
                        className="w-full pl-9 pr-3 py-2 border border-app rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--app-accent-ring)]"
                      />
                    </div>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-app mb-1">
                      {t("settings.legalAddress")}
                    </label>
                    <div className="relative">
                      <MapPin className="w-4 h-4 absolute left-3 top-2.5 text-app-muted" />
                      <input
                        type="text"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder={t("settings.addressPlaceholder")}
                        className="w-full pl-9 pr-3 py-2 border border-app rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--app-accent-ring)]"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Bank & Tax Rules Card */}
              <div className="app-card app-card-elevated p-6 space-y-4">
                <h2 className="text-sm font-bold text-app flex items-center gap-2 pb-2 border-b border-app">
                  <CreditCard className="w-4 h-4 text-emerald-600" />
                  {t("settings.bankAndTax")}
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-app mb-1">
                      {t("settings.bankName")}
                    </label>
                    <input
                      type="text"
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      placeholder={t("settings.bankPlaceholder")}
                      className="app-input"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-app mb-1">
                      {t("settings.iban")}
                    </label>
                    <input
                      type="text"
                      value={iban}
                      onChange={(e) => setIban(e.target.value)}
                      placeholder="AZ00000000000000000000000000"
                      className="app-input font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-app mb-1">
                      {t("settings.vatRate")}
                    </label>
                    <div className="relative">
                      <Percent className="w-4 h-4 absolute left-3 top-2.5 text-app-muted" />
                      <input
                        type="number"
                        step="0.01"
                        value={vatRate}
                        onChange={(e) => setVatRate(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 border border-app rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--app-accent-ring)] font-bold"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-app mb-1">
                      {t("settings.baseCurrency")}
                    </label>
                    <select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="app-input font-bold"
                    >
                      <option value="AZN">AZN (₼)</option>
                      <option value="USD">USD ($)</option>
                      <option value="EUR">EUR (€)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Submit Button */}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving || !can("can_manage_settings")}
                  title={
                    can("can_manage_settings")
                      ? undefined
                      : t("settings.noManagePermission")
                  }
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs px-6 py-3 rounded-xl transition-colors flex items-center gap-2 shadow-sm disabled:opacity-60"
                >
                  <Save className="w-4 h-4" />
                  {saving ? t("common.saving") : t("settings.saveSettings")}
                </button>
              </div>
            </form>
          )}
        </div>
        </PermissionGuard>
    </PageLayout>
  );
}