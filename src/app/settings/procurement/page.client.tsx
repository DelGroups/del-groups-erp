"use client";

import React, { useEffect, useState } from "react";
import { Save, ShoppingBag } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import PermissionGuard from "@/components/auth/PermissionGuard";
import SettingsTabs from "@/components/settings/SettingsTabs";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { useToast } from "@/hooks/useToast";
import ToastMessage from "@/components/ui/ToastMessage";
import {
  getProcurementConfigAction,
  saveProcurementConfigAction,
} from "@/lib/actions/procurementSettings";
import {
  DEFAULT_PROCUREMENT_CONFIG,
  parseProcurementConfig,
  procurementWeightTotal,
  type ProcurementConfig,
} from "@/lib/procurement/config";

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-lg border border-app bg-app px-3 py-2 text-sm">
      <span>
        <span className="block text-app">{label}</span>
        {hint ? <span className="mt-0.5 block text-[11px] text-app-muted">{hint}</span> : null}
      </span>
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--app-accent)]"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

export default function ProcurementSettingsPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const canManage = can("can_manage_settings");
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const [config, setConfig] = useState<ProcurementConfig>(DEFAULT_PROCUREMENT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const weightTotal = procurementWeightTotal(config);

  useEffect(() => {
    void getProcurementConfigAction().then((result) => {
      setLoading(false);
      if (!result.success) {
        showError(result.error);
        return;
      }
      if (result.data) setConfig(result.data);
    });
  }, [showError]);

  const patch = (partial: Partial<ProcurementConfig>) => {
    setConfig((current) => parseProcurementConfig({ ...current, ...partial }));
  };

  const handleSave = async () => {
    if (!canManage) return;
    setSaving(true);
    const result = await saveProcurementConfigAction(config);
    setSaving(false);
    if (!result.success) {
      showError(result.error);
      return;
    }
    if (result.data) setConfig(result.data);
    showSuccess(t("procurementSettings.saved"));
  };

  return (
    <PageLayout>
      <PermissionGuard permission="can_manage_settings">
        <SettingsTabs activeTab="procurement" />

        <div className="flex-1 overflow-y-auto bg-app p-6">
          <div className="mx-auto max-w-6xl space-y-6">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="flex items-center gap-2 text-xl font-bold text-app">
                  <ShoppingBag className="h-6 w-6 text-app-accent" />
                  {t("procurementSettings.title")}
                </h1>
                <p className="mt-1 text-sm text-app-muted">{t("procurementSettings.description")}</p>
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
                <h2 className="text-sm font-bold text-app">{t("procurementSettings.reorderTitle")}</h2>

                <ToggleRow
                  label={t("procurementSettings.autoCreate")}
                  hint={t("procurementSettings.autoCreateHint")}
                  checked={config.auto_create_purchase_request}
                  disabled={!canManage}
                  onChange={(auto_create_purchase_request) =>
                    patch({ auto_create_purchase_request })
                  }
                />

                <label className="block text-xs font-semibold text-app-muted">
                  {t("procurementSettings.leadTime")}
                  <input
                    type="number"
                    min={0}
                    max={365}
                    step={1}
                    className="app-input mt-1 w-full"
                    value={config.default_lead_time_days}
                    disabled={!canManage}
                    onChange={(event) =>
                      patch({ default_lead_time_days: Number(event.target.value) })
                    }
                  />
                </label>

                <ToggleRow
                  label={t("procurementSettings.criticalAlert")}
                  hint={t("procurementSettings.criticalAlertHint")}
                  checked={config.critical_stock_notification}
                  disabled={!canManage}
                  onChange={(critical_stock_notification) =>
                    patch({ critical_stock_notification })
                  }
                />
              </section>

              <section className="app-card app-card-elevated space-y-4 p-5">
                <h2 className="text-sm font-bold text-app">{t("procurementSettings.weightsTitle")}</h2>
                <p className="text-xs text-app-muted">{t("procurementSettings.weightsHint")}</p>

                <label className="block text-xs font-semibold text-app-muted">
                  {t("procurementSettings.priceWeight")}
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    className="app-input mt-1 w-full"
                    value={config.price_weight}
                    disabled={!canManage}
                    onChange={(event) => patch({ price_weight: Number(event.target.value) })}
                  />
                </label>

                <label className="block text-xs font-semibold text-app-muted">
                  {t("procurementSettings.qualityWeight")}
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    className="app-input mt-1 w-full"
                    value={config.quality_weight}
                    disabled={!canManage}
                    onChange={(event) => patch({ quality_weight: Number(event.target.value) })}
                  />
                </label>

                <label className="block text-xs font-semibold text-app-muted">
                  {t("procurementSettings.speedWeight")}
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    className="app-input mt-1 w-full"
                    value={config.delivery_speed_weight}
                    disabled={!canManage}
                    onChange={(event) =>
                      patch({ delivery_speed_weight: Number(event.target.value) })
                    }
                  />
                </label>

                <p
                  className={`text-xs font-semibold ${
                    weightTotal === 100 ? "text-emerald-600" : "text-amber-600"
                  }`}
                >
                  {t("procurementSettings.weightTotal", { total: weightTotal })}
                </p>
              </section>
            </div>
          </div>
        </div>

        <ToastMessage message={toastMessage} variant={toastVariant} />
      </PermissionGuard>
    </PageLayout>
  );
}
