"use client";

import { useState } from "react";
import { Mail, MapPin, Phone } from "lucide-react";
import { Combobox, Field, FormGrid, Section, SkeletonList, useToast } from "@/design-system/components";
import { useAuth } from "@/components/auth/AuthProvider";
import FileDropzone from "@/components/settings/FileDropzone";
import { useCompanyProfile, useRefreshCompanyProfile } from "@/hooks/useCompanyProfile";
import { useI18n } from "@/i18n/I18nProvider";
import { comboboxLabels } from "@/i18n/uiStandardLabels";
import { saveCompanyProfileAction, uploadCompanyAssetAction } from "@/lib/actions/companyProfile";
import { emailPlaceholder, type CompanyProfile } from "@/lib/company/profile";
import { SettingsSaveBar, useUnsavedChangesGuard } from "./SettingsSaveBar";
import { SettingsV2Page } from "./SettingsV2Page";
import { useSettingsDraft } from "./useSettingsDraft";

const CURRENCIES = [
  { value: "AZN", label: "AZN (₼)" },
  { value: "USD", label: "USD ($)" },
  { value: "EUR", label: "EUR (€)" },
];

type Draft = CompanyProfile & { vatRate: string };

function CompanyForm() {
  const { t } = useI18n();
  const { can, isAdmin } = useAuth();
  const { toast } = useToast();
  const company = useCompanyProfile();
  const refreshCompany = useRefreshCompanyProfile();
  const [form, setForm] = useState<Draft>({ ...company.profile, vatRate: String(company.profile.defaultVatRate) });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"logo" | "seal" | null>(null);
  const draft = useSettingsDraft<Draft>(form);
  const canManage = can("can_manage_settings");
  const brandingLocked = !isAdmin || company.source === "legacy";

  // Reset the form whenever a (re)loaded profile arrives (same rule as the classic page).
  const [formSource, setFormSource] = useState<CompanyProfile | null>(null);
  if (company.loaded && formSource !== company.profile) {
    const next = { ...company.profile, vatRate: String(company.profile.defaultVatRate) };
    setFormSource(company.profile);
    setForm(next);
    draft.markSaved(next);
  }

  const dirty = draft.isDirty(form);
  const leaveDialog = useUnsavedChangesGuard(dirty);
  const patch = (next: Partial<Draft>) => setForm((prev) => ({ ...prev, ...next }));
  const errorText = (error?: string) => (error?.startsWith("settings.") ? t(error) : t("common.errorOccurred", { message: error || "" }));

  const upload = async (kind: "logo" | "seal", file: File) => {
    setUploading(kind);
    const data = new FormData();
    data.append("kind", kind);
    data.append("file", file);
    const result = await uploadCompanyAssetAction(data);
    setUploading(null);
    if (!result.success) {
      toast(errorText(result.error), undefined, "error");
      return;
    }
    const url = result.data?.url ?? "";
    patch(kind === "logo" ? { logoUrl: url } : { sealUrl: url });
  };

  const save = async () => {
    setSaving(true);
    const { vatRate, ...profile } = form;
    const result = await saveCompanyProfileAction({ ...profile, defaultVatRate: parseFloat(vatRate) || 18 });
    setSaving(false);
    if (!result.success) {
      toast(errorText(result.error), undefined, "error");
      return;
    }
    draft.markSaved(form);
    toast(t("settings.saveSuccess"), undefined, "success");
    await refreshCompany();
  };

  if (!company.loaded) return <SkeletonList loading rows={6} label={t("common.dataLoading")}>{null}</SkeletonList>;

  const asset = (kind: "logo" | "seal", url: string) => (
    <Field label={t(`settings.${kind}`)} hint={t("settings.imageHint")}>
      <div className="flex flex-col gap-3">
        {url ? (
          <div className="flex items-center gap-3 rounded-[var(--ds-radius-md)] border p-3" style={{ borderColor: "var(--ds-border)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="h-14 w-14 object-contain" />
            <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" disabled={brandingLocked} onClick={() => patch(kind === "logo" ? { logoUrl: "" } : { sealUrl: "" })}>
              {t("settings.removeImage")}
            </button>
          </div>
        ) : null}
        <FileDropzone
          accept="image/png,image/jpeg,image/webp"
          disabled={brandingLocked || uploading !== null}
          label={uploading === kind ? t("settings.uploading") : t("settings.uploadImage")}
          hint={t("settings.imageHint")}
          onFile={(file) => void upload(kind, file)}
        />
      </div>
    </Field>
  );

  const iconInput = (Icon: typeof Phone, props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div className="relative">
      <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "var(--ds-text-subtle)" }} aria-hidden />
      <input className="ds-input w-full pl-9" disabled={!canManage} {...props} />
    </div>
  );

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty) void save();
      }}
    >
      <Section title={t("settings.branding")} description={company.source === "legacy" ? t("settings.migrationPending") : t("settings.adminOnlyNote")}>
        <FormGrid columns={2}>
          <Field label={t("settings.displayName")} hint={t("settings.displayNameHint")} span="full">
            {({ id, describedBy }) => <input id={id} aria-describedby={describedBy} className="ds-input w-full" value={form.displayName} disabled={brandingLocked} onChange={(e) => patch({ displayName: e.target.value })} />}
          </Field>
          {asset("logo", form.logoUrl)}
          {asset("seal", form.sealUrl)}
        </FormGrid>
      </Section>

      <Section title={t("settings.companyOfficial")}>
        <FormGrid columns={2}>
          <Field label={t("settings.companyName")} required>
            {({ id }) => <input id={id} className="ds-input w-full" required aria-required value={form.legalName} disabled={!canManage} onChange={(e) => patch({ legalName: e.target.value })} />}
          </Field>
          <Field label={t("settings.voen")}>
            {({ id }) => <input id={id} className="ds-input ds-mono w-full" value={form.voen} placeholder={t("settings.voenPlaceholder")} disabled={!canManage} onChange={(e) => patch({ voen: e.target.value })} />}
          </Field>
          <Field label={t("settings.phoneNumber")}>
            {({ id }) => iconInput(Phone, { id, type: "tel", value: form.phone, placeholder: "+994 50 000 00 00", onChange: (e) => patch({ phone: e.target.value }) })}
          </Field>
          <Field label={t("settings.emailAddress")}>
            {({ id }) => iconInput(Mail, { id, type: "email", value: form.email, placeholder: emailPlaceholder(form, "info"), onChange: (e) => patch({ email: e.target.value }) })}
          </Field>
          <Field label={t("settings.legalAddress")} span="full">
            {({ id }) => iconInput(MapPin, { id, value: form.address, placeholder: t("settings.addressPlaceholder"), onChange: (e) => patch({ address: e.target.value }) })}
          </Field>
        </FormGrid>
      </Section>

      <Section title={t("settings.bankAndTax")}>
        <FormGrid columns={2}>
          <Field label={t("settings.bankName")}>
            {({ id }) => <input id={id} className="ds-input w-full" value={form.bankName} placeholder={t("settings.bankPlaceholder")} disabled={!canManage} onChange={(e) => patch({ bankName: e.target.value })} />}
          </Field>
          <Field label={t("settings.iban")}>
            {({ id }) => <input id={id} className="ds-input ds-mono w-full" value={form.iban} placeholder="AZ00000000000000000000000000" disabled={!canManage} onChange={(e) => patch({ iban: e.target.value })} />}
          </Field>
          <Field label={t("settings.vatRate")}>
            {({ id }) => <input id={id} className="ds-input ds-w-sm" type="number" step="0.01" inputMode="decimal" value={form.vatRate} disabled={!canManage} onChange={(e) => patch({ vatRate: e.target.value })} />}
          </Field>
          <Field label={t("settings.baseCurrency")}>
            {({ id }) => <Combobox id={id} value={form.defaultCurrency} options={CURRENCIES} labels={comboboxLabels(t)} disabled={!canManage} width="sm" onChange={(value) => value && patch({ defaultCurrency: value })} />}
          </Field>
        </FormGrid>
      </Section>

      <SettingsSaveBar dirty={dirty} saving={saving} disabled={!canManage} onSave={() => void save()} onDiscard={() => setForm(draft.saved)} />
      {leaveDialog}
    </form>
  );
}

/** Company profile with SETTINGS_V2 (/settings/company). */
export function CompanyProfileV2() {
  return (
    <SettingsV2Page id="company">
      <CompanyForm />
    </SettingsV2Page>
  );
}
