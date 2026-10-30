"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Save } from "lucide-react";
import { EmptyState, SkeletonList, useToast } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { methodsFor, type ImportCostTypeConfig, type ImportsConfig } from "@/lib/imports/config";
import { COST_TYPES, type CostType, type SplitMethod } from "@/lib/imports/landedCost";
import { ViewScope } from "@/views";
import { getImportsConfigAction, importLookupsAction, saveImportsConfigAction } from "../actions/imports";

const CONFIG_KEY = ["imports", "config"] as const;

/** Settings › Imports (IMP-1): customs VAT, chargeable weight and the defaults of each cost type. */
export default function ImportSettingsScreen() {
  return (
    <ViewScope>
      <Settings />
    </ViewScope>
  );
}

function Settings() {
  const { t } = useI18n();
  const config = useQuery({
    queryKey: CONFIG_KEY,
    queryFn: async () => {
      const r = await getImportsConfigAction();
      if (!r.success) throw new Error(r.error);
      return r.data;
    },
  });
  const suppliers = useQuery({
    queryKey: ["imports", "lookups"],
    queryFn: async () => {
      const r = await importLookupsAction();
      if (!r.success) throw new Error(r.error);
      return r.data;
    },
  });
  if (config.error) {
    const key = config.error instanceof Error && config.error.message.startsWith("imports.") ? config.error.message : "imports.errors.failed";
    return <EmptyState icon={AlertTriangle} title={t(key)} description={t("imports.errors.loadHint")} />;
  }
  if (!config.data) return <SkeletonList loading rows={6} label={t("common.loading")}>{null}</SkeletonList>;
  return <SettingsForm key={config.dataUpdatedAt} initial={config.data} suppliers={suppliers.data?.suppliers ?? []} />;
}

function SettingsForm({ initial, suppliers }: { initial: ImportsConfig; suppliers: { id: string; name: string }[] }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const client = useQueryClient();
  const [config, setConfig] = useState(initial);
  const [saving, setSaving] = useState(false);

  const setType = (type: CostType, patch: Partial<ImportCostTypeConfig>) =>
    setConfig((c) => ({ ...c, costTypes: { ...c.costTypes, [type]: { ...c.costTypes[type], ...patch } } }));
  const toggleCustomsValue = (type: CostType, on: boolean) =>
    setConfig((c) => ({ ...c, customsValueCostTypes: on ? [...new Set([...c.customsValueCostTypes, type])] : c.customsValueCostTypes.filter((x) => x !== type) }));

  const save = async () => {
    setSaving(true);
    const r = await saveImportsConfigAction(config);
    setSaving(false);
    if (!r.success) {
      toast(t("imports.errors.saveFailed"), t(r.error), "error");
      return;
    }
    toast(t("imports.settings.saved"), undefined, "success");
    await client.invalidateQueries({ queryKey: CONFIG_KEY });
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/imports" className="ds-btn ds-btn-sm ds-btn-ghost mb-1">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t("imports.backToList")}
          </Link>
          <h1 className="text-[length:var(--ds-text-xl)] font-semibold">{t("imports.settings.title")}</h1>
          <p className="ds-muted">{t("imports.settings.subtitle")}</p>
        </div>
        <button type="button" className="ds-btn ds-btn-primary" onClick={() => void save()} disabled={saving}>
          <Save className="h-4 w-4" aria-hidden />
          {saving ? t("common.saving") : t("common.save")}
        </button>
      </header>

      <section className="ds-card ds-card-pad grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label={t("imports.settings.general")}>
        <label className="flex flex-col gap-1">
          <span className="ds-label">{t("imports.settings.customsVatRate")}</span>
          <input className="ds-input ds-mono w-28" type="number" min={0} max={100} step={0.5} value={config.customsVatRatePct} onChange={(e) => setConfig((c) => ({ ...c, customsVatRatePct: Number(e.target.value) }))} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="ds-label">{t("imports.settings.chargeableFactor")}</span>
          <input className="ds-input ds-mono w-28" type="number" min={1} max={10000} step={1} value={config.chargeableFactor} onChange={(e) => setConfig((c) => ({ ...c, chargeableFactor: Number(e.target.value) }))} />
          <span className="text-[length:var(--ds-text-xs)] ds-muted">{t("imports.settings.chargeableFactorHint")}</span>
        </label>
      </section>

      <section className="ds-card ds-card-pad flex flex-col gap-3" aria-labelledby="imports-cost-types">
        <div>
          <h2 id="imports-cost-types" className="font-semibold">{t("imports.settings.costTypes")}</h2>
          <p className="text-[length:var(--ds-text-xs)] ds-muted">{t("imports.settings.costTypesHint")}</p>
        </div>
        <div className="overflow-x-auto overscroll-x-contain">
          <table className="w-full min-w-[56rem] border-collapse text-[length:var(--ds-text-sm)]">
            <thead>
              <tr>
                {["type", "name", "method", "capitalized", "customsValue", "vat", "partner"].map((k) => (
                  <th key={k} scope="col" className="px-2 py-1.5 text-start font-semibold">{t(`imports.settings.col_${k}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COST_TYPES.map((type) => {
                const row = config.costTypes[type];
                const builtIn = t(`imports.costTypes.${type}`);
                const vatOnly = type === "customs_vat";
                const customsValueAllowed = !vatOnly && type !== "customs_duty";
                return (
                  <tr key={type} style={{ borderTop: "1px solid var(--ds-border)" }}>
                    <th scope="row" className="px-2 py-1.5 text-start font-medium">{builtIn}</th>
                    <td className="px-2 py-1.5">
                      <input className="ds-input w-44" aria-label={`${t("imports.settings.col_name")}: ${builtIn}`} placeholder={builtIn} value={row.name ?? ""} maxLength={80} onChange={(e) => setType(type, { name: e.target.value || null })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <select className="ds-input" aria-label={`${t("imports.settings.col_method")}: ${builtIn}`} value={row.defaultMethod} onChange={(e) => setType(type, { defaultMethod: e.target.value as SplitMethod })} disabled={vatOnly}>
                        {methodsFor(type).map((m) => (
                          <option key={m} value={m}>{t(`imports.methods.${m}`)}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="checkbox" aria-label={`${t("imports.settings.col_capitalized")}: ${builtIn}`} checked={row.defaultCapitalized} disabled={vatOnly} onChange={(e) => setType(type, { defaultCapitalized: e.target.checked })} />
                    </td>
                    <td className="px-2 py-1.5">
                      {customsValueAllowed ? (
                        <input type="checkbox" aria-label={`${t("imports.settings.col_customsValue")}: ${builtIn}`} checked={config.customsValueCostTypes.includes(type)} onChange={(e) => toggleCustomsValue(type, e.target.checked)} />
                      ) : (
                        <span className="ds-muted">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className="inline-flex items-center gap-1">
                        <input className="ds-input ds-mono w-20" type="number" min={0} max={100} step={0.5} aria-label={`${t("imports.settings.col_vat")}: ${builtIn}`} value={row.defaultVatRatePct} disabled={vatOnly} onChange={(e) => setType(type, { defaultVatRatePct: Number(e.target.value) })} />%
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      <select className="ds-input" aria-label={`${t("imports.settings.col_partner")}: ${builtIn}`} value={row.defaultPartnerId ?? ""} onChange={(e) => setType(type, { defaultPartnerId: e.target.value || null })}>
                        <option value="">—</option>
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
