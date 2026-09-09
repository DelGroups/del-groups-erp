"use client";

import React, { useEffect, useState } from "react";
import { Barcode, Printer, Save } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import PermissionGuard from "@/components/auth/PermissionGuard";
import SettingsTabs from "@/components/settings/SettingsTabs";
import ThermalLabelPrintTemplate from "@/components/products/ThermalLabelPrintTemplate";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { useCompanyBranding } from "@/hooks/useCompanyBranding";
import { useDocumentPrint } from "@/hooks/useDocumentPrint";
import { useToast } from "@/hooks/useToast";
import ToastMessage from "@/components/ui/ToastMessage";
import {
  getBarcodeLabelConfigAction,
  saveBarcodeLabelConfigAction,
} from "@/lib/actions/barcodeSettings";
import {
  BARCODE_PAPER_SIZES,
  BARCODE_SYMBOL_TYPES,
  DEFAULT_BARCODE_LABEL_CONFIG,
  SAMPLE_THERMAL_LABEL,
  resolveLabelDimensions,
  type BarcodeLabelConfig,
  type BarcodePaperSize,
  type BarcodeSymbolType,
} from "@/lib/barcode/labelConfig";

function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-app bg-app px-3 py-2 text-sm">
      <span className="text-app">{label}</span>
      <input
        type="checkbox"
        className="h-4 w-4 accent-[color:var(--app-accent)]"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

export default function BarcodeSettingsPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const canManage = can("can_manage_settings");
  const branding = useCompanyBranding();
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const [config, setConfig] = useState<BarcodeLabelConfig>(DEFAULT_BARCODE_LABEL_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { printData: printJob, setPrintData: setPrintJob } = useDocumentPrint<BarcodeLabelConfig>(400);
  const dims = resolveLabelDimensions(config);

  useEffect(() => {
    void getBarcodeLabelConfigAction().then((result) => {
      setLoading(false);
      if (!result.success) {
        showError(result.error);
        return;
      }
      if (result.data) setConfig(result.data);
    });
  }, [showError]);

  const patch = (partial: Partial<BarcodeLabelConfig>) => {
    setConfig((current) => ({ ...current, ...partial }));
  };

  const handleSave = async () => {
    if (!canManage) return;
    setSaving(true);
    const result = await saveBarcodeLabelConfigAction(config);
    setSaving(false);
    if (!result.success) {
      showError(result.error);
      return;
    }
    if (result.data) setConfig(result.data);
    showSuccess(t("barcodeSettings.saved"));
  };

  return (
    <PageLayout>
      <PermissionGuard permission="can_manage_settings">
        <SettingsTabs activeTab="barcode" />

        <div className="flex-1 overflow-y-auto bg-app p-6">
          <div className="mx-auto max-w-7xl space-y-6">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="flex items-center gap-2 text-xl font-bold text-app">
                  <Barcode className="h-6 w-6 text-app-accent" />
                  {t("barcodeSettings.title")}
                </h1>
                <p className="mt-1 text-sm text-app-muted">{t("barcodeSettings.description")}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-ghost inline-flex items-center gap-2"
                  onClick={() => setPrintJob(config)}
                >
                  <Printer className="h-4 w-4" />
                  {t("barcodeSettings.testPrint")}
                </button>
                <button
                  type="button"
                  className="btn-primary inline-flex items-center gap-2"
                  disabled={!canManage || saving || loading}
                  onClick={() => void handleSave()}
                >
                  <Save className="h-4 w-4" />
                  {saving ? t("common.saving") : t("common.save")}
                </button>
              </div>
            </header>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,22rem)_1fr]">
              <section className="app-card app-card-elevated space-y-4 p-5">
                <h2 className="text-sm font-bold text-app">{t("barcodeSettings.controls")}</h2>

                <label className="block text-xs font-semibold text-app-muted">
                  {t("barcodeSettings.paperSize")}
                  <select
                    className="app-input mt-1 w-full"
                    value={config.paper_size}
                    disabled={!canManage}
                    onChange={(event) => patch({ paper_size: event.target.value as BarcodePaperSize })}
                  >
                    {BARCODE_PAPER_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {t(`barcodeSettings.paperSizes.${size}`)}
                      </option>
                    ))}
                  </select>
                </label>

                {config.paper_size === "CUSTOM" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs font-semibold text-app-muted">
                      {t("barcodeSettings.widthMm")}
                      <input
                        type="number"
                        min={20}
                        max={210}
                        className="app-input mt-1 w-full"
                        value={config.custom_width_mm}
                        disabled={!canManage}
                        onChange={(event) => patch({ custom_width_mm: Number(event.target.value) })}
                      />
                    </label>
                    <label className="block text-xs font-semibold text-app-muted">
                      {t("barcodeSettings.heightMm")}
                      <input
                        type="number"
                        min={15}
                        max={297}
                        className="app-input mt-1 w-full"
                        value={config.custom_height_mm}
                        disabled={!canManage}
                        onChange={(event) => patch({ custom_height_mm: Number(event.target.value) })}
                      />
                    </label>
                  </div>
                ) : null}

                <label className="block text-xs font-semibold text-app-muted">
                  {t("barcodeSettings.barcodeType")}
                  <select
                    className="app-input mt-1 w-full"
                    value={config.barcode_type}
                    disabled={!canManage}
                    onChange={(event) =>
                      patch({ barcode_type: event.target.value as BarcodeSymbolType })
                    }
                  >
                    {BARCODE_SYMBOL_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(`barcodeSettings.barcodeTypes.${type}`)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-xs font-semibold text-app-muted">
                  {t("barcodeSettings.headerTitle")}
                  <input
                    className="app-input mt-1 w-full"
                    value={config.header_title}
                    disabled={!canManage}
                    maxLength={80}
                    onChange={(event) => patch({ header_title: event.target.value })}
                  />
                </label>

                <label className="block text-xs font-semibold text-app-muted">
                  {t("barcodeSettings.paddingMm")}
                  <input
                    type="number"
                    min={0}
                    max={12}
                    step={0.5}
                    className="app-input mt-1 w-full"
                    value={config.margin_padding_mm}
                    disabled={!canManage}
                    onChange={(event) => patch({ margin_padding_mm: Number(event.target.value) })}
                  />
                </label>

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-app-muted">{t("barcodeSettings.fields")}</p>
                  <ToggleRow
                    label={t("barcodeSettings.showLogo")}
                    checked={config.show_company_logo}
                    disabled={!canManage}
                    onChange={(show_company_logo) => patch({ show_company_logo })}
                  />
                  <ToggleRow
                    label={t("barcodeSettings.showItemCode")}
                    checked={config.show_item_code}
                    disabled={!canManage}
                    onChange={(show_item_code) => patch({ show_item_code })}
                  />
                  <ToggleRow
                    label={t("barcodeSettings.showPrice")}
                    checked={config.show_price}
                    disabled={!canManage}
                    onChange={(show_price) => patch({ show_price })}
                  />
                  <ToggleRow
                    label={t("barcodeSettings.showDimensions")}
                    checked={config.show_dimensions}
                    disabled={!canManage}
                    onChange={(show_dimensions) => patch({ show_dimensions })}
                  />
                  <ToggleRow
                    label={t("barcodeSettings.showWarehouse")}
                    checked={config.show_warehouse_location}
                    disabled={!canManage}
                    onChange={(show_warehouse_location) => patch({ show_warehouse_location })}
                  />
                </div>
              </section>

              <section className="app-card app-card-elevated p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-sm font-bold text-app">{t("barcodeSettings.preview")}</h2>
                  <span className="font-mono text-[11px] text-app-muted">
                    {dims.widthMm} × {dims.heightMm} mm
                  </span>
                </div>
                <div className="flex min-h-[28rem] items-center justify-center overflow-auto rounded-xl bg-[repeating-linear-gradient(45deg,#1e293b_0_8px,#0f172a_8px_16px)] p-8">
                  <div className="shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
                    <ThermalLabelPrintTemplate
                      items={[SAMPLE_THERMAL_LABEL]}
                      branding={branding}
                      config={config}
                      preview
                    />
                  </div>
                </div>
                <p className="mt-3 text-[11px] text-app-muted">{t("barcodeSettings.previewHint")}</p>
              </section>
            </div>
          </div>
        </div>

        {printJob ? (
          <div className="print-area">
            <ThermalLabelPrintTemplate
              items={[SAMPLE_THERMAL_LABEL]}
              branding={branding}
              config={printJob}
            />
          </div>
        ) : null}

        <ToastMessage message={toastMessage} variant={toastVariant} />
      </PermissionGuard>
    </PageLayout>
  );
}
