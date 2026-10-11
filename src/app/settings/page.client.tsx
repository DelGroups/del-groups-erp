"use client";

import React, { useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import PermissionGuard from "@/components/auth/PermissionGuard";
import SettingsTabs from "@/components/settings/SettingsTabs";
import AiN8nSettingsCard from "@/components/settings/AiN8nSettingsCard";
import { useEnabledModules } from "@/hooks/useEnabledModules";
import FileDropzone from "@/components/settings/FileDropzone";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import { useCompanyProfile, useRefreshCompanyProfile } from "@/hooks/useCompanyProfile";
import { saveCompanyProfileAction, uploadCompanyAssetAction } from "@/lib/actions/companyProfile";
import { emailPlaceholder, type CompanyProfile } from "@/lib/company/profile";
import {
  Settings,
  Building2,
  Save,
  Percent,
  CreditCard,
  Phone,
  Mail,
  MapPin,
  CheckCircle2,
  Image as ImageIcon,
} from "lucide-react";

export default function SettingsPage() {
  const { t } = useI18n();
  const { can, isAdmin } = useAuth();
  const company = useCompanyProfile();
  const { isEnabled: isModuleEnabled } = useEnabledModules();
  const refreshCompany = useRefreshCompanyProfile();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"logo" | "seal" | null>(null);
  const [successMsg, setSuccessMsg] = useState("");
  const { message: toastMessage, variant: toastVariant, showError } = useToast();

  const [form, setForm] = useState<CompanyProfile>(company.profile);
  const [vatRate, setVatRate] = useState(String(company.profile.defaultVatRate));
  const loading = !company.loaded;
  const brandingLocked = !isAdmin || company.source === "legacy";

  // Reset the form whenever a (re)loaded profile arrives.
  const [formSource, setFormSource] = useState<CompanyProfile | null>(null);
  if (company.loaded && formSource !== company.profile) {
    setFormSource(company.profile);
    setForm(company.profile);
    setVatRate(String(company.profile.defaultVatRate));
  }

  const patch = (next: Partial<CompanyProfile>) => setForm((prev) => ({ ...prev, ...next }));
  const errorText = (error?: string) =>
    error?.startsWith("settings.") ? t(error) : t("common.errorOccurred", { message: error || "" });

  const handleUpload = async (kind: "logo" | "seal", file: File) => {
    setUploading(kind);
    const formData = new FormData();
    formData.append("kind", kind);
    formData.append("file", file);
    const result = await uploadCompanyAssetAction(formData);
    setUploading(null);
    if (!result.success) {
      showError(errorText(result.error));
      return;
    }
    const url = result.data?.url ?? "";
    patch(kind === "logo" ? { logoUrl: url } : { sealUrl: url });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSuccessMsg("");

    const result = await saveCompanyProfileAction({
      ...form,
      defaultVatRate: parseFloat(vatRate) || 18,
    });

    if (result.success) {
      setSuccessMsg(t("settings.saveSuccess"));
      setTimeout(() => setSuccessMsg(""), 4000);
      await refreshCompany();
    } else {
      showError(errorText(result.error));
    }
    setSaving(false);
  };

  const assetField = (kind: "logo" | "seal", url: string) => (
    <div>
      <p className="mb-2 text-xs font-semibold text-app">{t(`settings.${kind}`)}</p>
      {url ? (
        <div className="mb-3 flex items-center gap-3 rounded-lg border border-app bg-app p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className="h-16 w-16 object-contain" />
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={brandingLocked}
            onClick={() => patch(kind === "logo" ? { logoUrl: "" } : { sealUrl: "" })}
          >
            {t("settings.removeImage")}
          </button>
        </div>
      ) : null}
      <FileDropzone
        accept="image/png,image/jpeg,image/webp"
        disabled={brandingLocked || uploading !== null}
        label={uploading === kind ? t("settings.uploading") : t("settings.uploadImage")}
        hint={t("settings.imageHint")}
        onFile={(file) => void handleUpload(kind, file)}
      />
    </div>
  );

  return (
    <PageLayout>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-app app-glass px-6 py-4">
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
            <div className="alert-success p-4 text-xs font-bold rounded-xl flex items-center gap-2">
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
              {/* Brand card: header name, logo, seal (admin only) */}
              <div className="app-card app-card-elevated p-6 space-y-4">
                <h2 className="text-sm font-bold text-app flex items-center gap-2 pb-2 border-b border-app">
                  <ImageIcon className="w-4 h-4 text-app-accent" />
                  {t("settings.branding")}
                </h2>
                <p className="text-xs text-app-muted">
                  {company.source === "legacy" ? t("settings.migrationPending") : t("settings.adminOnlyNote")}
                </p>

                <div>
                  <label className="block text-xs font-semibold text-app mb-1">
                    {t("settings.displayName")}
                  </label>
                  <input
                    type="text"
                    value={form.displayName}
                    disabled={brandingLocked}
                    onChange={(e) => patch({ displayName: e.target.value })}
                    className="app-input"
                  />
                  <p className="mt-1 text-[11px] text-app-muted">{t("settings.displayNameHint")}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {assetField("logo", form.logoUrl)}
                  {assetField("seal", form.sealUrl)}
                </div>
              </div>

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
                      value={form.legalName}
                      onChange={(e) => patch({ legalName: e.target.value })}
                      className="app-input"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-app mb-1">
                      {t("settings.voen")}
                    </label>
                    <input
                      type="text"
                      value={form.voen}
                      onChange={(e) => patch({ voen: e.target.value })}
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
                        value={form.phone}
                        onChange={(e) => patch({ phone: e.target.value })}
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
                        value={form.email}
                        onChange={(e) => patch({ email: e.target.value })}
                        placeholder={emailPlaceholder(form, "info")}
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
                        value={form.address}
                        onChange={(e) => patch({ address: e.target.value })}
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
                      value={form.bankName}
                      onChange={(e) => patch({ bankName: e.target.value })}
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
                      value={form.iban}
                      onChange={(e) => patch({ iban: e.target.value })}
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
                      value={form.defaultCurrency}
                      onChange={(e) => patch({ defaultCurrency: e.target.value })}
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
                  className="bg-[image:var(--app-gradient)] hover:brightness-110 text-white font-semibold text-xs px-6 py-3 rounded-xl transition-colors flex items-center gap-2 shadow-sm disabled:opacity-60"
                >
                  <Save className="w-4 h-4" />
                  {saving ? t("common.saving") : t("settings.saveSettings")}
                </button>
              </div>
            </form>
          )}

          {isModuleEnabled("ai") ? <AiN8nSettingsCard /> : null}
        </div>
        </PermissionGuard>
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}