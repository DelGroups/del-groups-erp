"use client";

import React, { useEffect, useState } from "react";
import { Save, Scale } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import PermissionGuard from "@/components/auth/PermissionGuard";
import SettingsTabs from "@/components/settings/SettingsTabs";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { useToast } from "@/hooks/useToast";
import ToastMessage from "@/components/ui/ToastMessage";
import {
  getTaxPayrollConfigAction,
  saveTaxPayrollConfigAction,
} from "@/lib/actions/taxPayrollSettings";
import {
  DEFAULT_TAX_PAYROLL_CONFIG,
  DEFAULT_VAT_RATE_OPTIONS,
  E_QAIME_EXPORT_FORMATS,
  parseTaxPayrollConfig,
  type DefaultVatRateOption,
  type EQaimeExportFormat,
  type TaxPayrollConfig,
} from "@/lib/tax/payrollConfig";

export default function TaxPayrollSettingsPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const canManage = can("can_manage_settings");
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const [config, setConfig] = useState<TaxPayrollConfig>(DEFAULT_TAX_PAYROLL_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getTaxPayrollConfigAction().then((result) => {
      setLoading(false);
      if (!result.success) {
        showError(result.error);
        return;
      }
      if (result.data) setConfig(result.data);
    });
  }, [showError]);

  const patch = (partial: Partial<TaxPayrollConfig>) => {
    setConfig((current) => parseTaxPayrollConfig({ ...current, ...partial }));
  };

  const handleSave = async () => {
    if (!canManage) return;
    setSaving(true);
    const result = await saveTaxPayrollConfigAction(config);
    setSaving(false);
    if (!result.success) {
      showError(result.error);
      return;
    }
    if (result.data) setConfig(result.data);
    showSuccess(t("taxPayrollSettings.saved"));
  };

  return (
    <PageLayout>
      <PermissionGuard permission="can_manage_settings">
        <SettingsTabs activeTab="tax-payroll" />

        <div className="flex-1 overflow-y-auto bg-app p-6">
          <div className="mx-auto max-w-6xl space-y-6">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="flex items-center gap-2 text-xl font-bold text-app">
                  <Scale className="h-6 w-6 text-app-accent" />
                  {t("taxPayrollSettings.title")}
                </h1>
                <p className="mt-1 text-sm text-app-muted">{t("taxPayrollSettings.description")}</p>
              </div>
              <button
                type="button"
                className="btn-primary inline-flex items-center gap-2"
                disabled={!canManage || saving || loading}
                onClick={() => void handleSave()}
              >
                <Save className="h-4 w-4" />
                {saving ? t("common.saving") : t("common.save")}
              </button>
            </header>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="app-card app-card-elevated space-y-4 p-5">
                <h2 className="text-sm font-bold text-app">{t("taxPayrollSettings.eQaimeTitle")}</h2>

                <label className="block text-xs font-semibold text-app-muted">
                  {t("taxPayrollSettings.companyVoen")}
                  <input
                    className="app-input mt-1 w-full font-mono"
                    value={config.company_voen}
                    disabled={!canManage}
                    maxLength={10}
                    inputMode="numeric"
                    placeholder={t("taxPayrollSettings.voenPlaceholder")}
                    onChange={(event) => patch({ company_voen: event.target.value })}
                  />
                </label>

                <label className="block text-xs font-semibold text-app-muted">
                  {t("taxPayrollSettings.defaultVat")}
                  <select
                    className="app-input mt-1 w-full"
                    value={config.default_vat_rate}
                    disabled={!canManage}
                    onChange={(event) =>
                      patch({ default_vat_rate: event.target.value as DefaultVatRateOption })
                    }
                  >
                    {DEFAULT_VAT_RATE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {t(`taxPayrollSettings.vatRates.${option}`)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-xs font-semibold text-app-muted">
                  {t("taxPayrollSettings.exportFormat")}
                  <select
                    className="app-input mt-1 w-full"
                    value={config.e_qaime_export_format}
                    disabled={!canManage}
                    onChange={(event) =>
                      patch({ e_qaime_export_format: event.target.value as EQaimeExportFormat })
                    }
                  >
                    {E_QAIME_EXPORT_FORMATS.map((option) => (
                      <option key={option} value={option}>
                        {t(`taxPayrollSettings.formats.${option}`)}
                      </option>
                    ))}
                  </select>
                </label>
              </section>

              <section className="app-card app-card-elevated space-y-4 p-5">
                <h2 className="text-sm font-bold text-app">{t("taxPayrollSettings.payrollTitle")}</h2>
                <p className="text-xs text-app-muted">{t("taxPayrollSettings.payrollHint")}</p>

                <label className="block text-xs font-semibold text-app-muted">
                  {t("taxPayrollSettings.dsmfEmployer")}
                  <input
                    type="number"
                    min={0}
                    max={50}
                    step={0.01}
                    className="app-input mt-1 w-full"
                    value={config.dsmf_employer_rate}
                    disabled={!canManage}
                    onChange={(event) =>
                      patch({ dsmf_employer_rate: Number(event.target.value) })
                    }
                  />
                </label>

                <label className="block text-xs font-semibold text-app-muted">
                  {t("taxPayrollSettings.dsmfEmployee")}
                  <input
                    type="number"
                    min={0}
                    max={50}
                    step={0.01}
                    className="app-input mt-1 w-full"
                    value={config.dsmf_employee_rate}
                    disabled={!canManage}
                    onChange={(event) =>
                      patch({ dsmf_employee_rate: Number(event.target.value) })
                    }
                  />
                </label>

                <label className="block text-xs font-semibold text-app-muted">
                  {t("taxPayrollSettings.itsRate")}
                  <input
                    type="number"
                    min={0}
                    max={10}
                    step={0.01}
                    className="app-input mt-1 w-full"
                    value={config.its_rate}
                    disabled={!canManage}
                    onChange={(event) => patch({ its_rate: Number(event.target.value) })}
                  />
                </label>

                <label className="block text-xs font-semibold text-app-muted">
                  {t("taxPayrollSettings.taxFreeLimit")}
                  <input
                    type="number"
                    min={0}
                    max={100000}
                    step={1}
                    className="app-input mt-1 w-full"
                    value={config.non_taxable_salary_limit}
                    disabled={!canManage}
                    onChange={(event) =>
                      patch({ non_taxable_salary_limit: Number(event.target.value) })
                    }
                  />
                </label>
              </section>
            </div>
          </div>
        </div>

        <ToastMessage message={toastMessage} variant={toastVariant} />
      </PermissionGuard>
    </PageLayout>
  );
}
