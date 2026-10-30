"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Lock, RefreshCw, Save, Trash2 } from "lucide-react";
import { EmptyState, SkeletonList, useToast } from "@/design-system/components";
import { useAuth } from "@/components/auth/AuthProvider";
import { useRecordCrumb } from "@/components/shell/useShell";
import { useI18n } from "@/i18n/I18nProvider";
import { IMPORT_CURRENCIES, type ImportCurrency } from "@/lib/imports/cbar";
import { methodsFor, type ImportsConfig } from "@/lib/imports/config";
import { COST_TYPES, round2, stockQuantity, type CostType, type SplitMethod } from "@/lib/imports/landedCost";
import { invalidateModel, ViewScope } from "@/views";
import { RecordChatter } from "@/views/chatter/RecordChatter";
import {
  cbarRateAction,
  getImportsConfigAction,
  getShipmentAction,
  importLookupsAction,
  saveShipmentDraftAction,
  type ImportLookups,
  type ShipmentView,
} from "../actions/imports";
import {
  draftIssues,
  emptyShipment,
  INCOTERMS,
  landedCostOf,
  newCost,
  newLine,
  suggestedVat,
  type CostLineDraft,
  type ShipmentDraft,
  type ShipmentLineDraft,
} from "../lib/shipment";
import { IMPORTS_VIEW_KEY } from "../views/imports";
import { costTypeLabel, LandedCostPanel } from "./LandedCostPanel";

const LOOKUPS_KEY = ["imports", "lookups"] as const;
const CONFIG_KEY = ["imports", "config"] as const;

async function unwrap<T>(p: Promise<{ success: true; data: T } | { success: false; error: string }>): Promise<T> {
  const r = await p;
  if (!r.success) throw new Error(r.error);
  return r.data;
}

/** One import shipment (IMP-1): header, product lines, costs and the live landed cost. id "new" = a new draft. */
export default function ImportFormScreen({ id }: { id: string }) {
  return (
    <ViewScope>
      <Loader id={id} />
    </ViewScope>
  );
}

function Loader({ id }: { id: string }) {
  const { t } = useI18n();
  const isNew = id === "new";
  const lookups = useQuery({ queryKey: LOOKUPS_KEY, queryFn: () => unwrap(importLookupsAction()) });
  const config = useQuery({ queryKey: CONFIG_KEY, queryFn: () => unwrap(getImportsConfigAction()) });
  const shipment = useQuery({ queryKey: ["imports", "shipment", id], queryFn: () => unwrap(getShipmentAction(id)), enabled: !isNew });
  const error = lookups.error || config.error || shipment.error;
  if (error) {
    const key = error instanceof Error && error.message.startsWith("imports.") ? error.message : "imports.errors.failed";
    return <EmptyState icon={AlertTriangle} title={t(key)} description={t("imports.errors.loadHint")} />;
  }
  if (!lookups.data || !config.data || (!isNew && !shipment.data)) {
    return <SkeletonList loading rows={6} label={t("common.loading")}>{null}</SkeletonList>;
  }
  const view: ShipmentView = shipment.data ?? { draft: emptyShipment(), financials: true, createdByName: null, createdAt: null, updatedAt: null };
  // A new key per loaded version, so the form starts again from what was saved.
  return <ShipmentForm key={`${id}-${shipment.dataUpdatedAt}`} view={view} lookups={lookups.data} config={config.data} />;
}

/** A number field that keeps what is typed ("1," or "0.") and reports the parsed value. */
function NumberField({
  value,
  onChange,
  label,
  className = "w-24",
  min = 0,
  disabled,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  label: string;
  className?: string;
  min?: number;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    if (Number(text.replace(",", ".")) !== value) setText(value === null ? "" : String(value));
  }
  return (
    <input
      className={`ds-input ds-mono tabular-nums ${className}`}
      inputMode="decimal"
      type="text"
      aria-label={label}
      value={text}
      disabled={disabled}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        const parsed = next.trim() === "" ? null : Number(next.replace(",", "."));
        if (parsed === null || (Number.isFinite(parsed) && parsed >= min)) {
          setLast(parsed);
          onChange(parsed);
        }
      }}
    />
  );
}

function ShipmentForm({ view, lookups, config }: { view: ShipmentView; lookups: ImportLookups; config: ImportsConfig }) {
  const { t, formatDate } = useI18n();
  const { can } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const client = useQueryClient();
  const [draft, setDraft] = useState<ShipmentDraft>(() => {
    if (view.draft.id || view.draft.costs.length) return view.draft;
    // A new shipment starts with a duty line, so line duty rates reach the landed cost.
    const fresh = emptyShipment();
    return { ...fresh, defaultWarehouseId: lookups.warehouses.find((w) => w.isDefault)?.id ?? null, costs: [newCost("customs_duty", config)] };
  });
  const [marginPct, setMarginPct] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [rateBusy, setRateBusy] = useState<string | null>(null);
  const [productQuery, setProductQuery] = useState("");
  const [showIssues, setShowIssues] = useState(false);
  useRecordCrumb(draft.number ?? t("imports.newShipment"));

  const editable = draft.status === "draft" && view.financials && can("can_manage_imports");
  const products = useMemo(() => new Map(lookups.products.map((p) => [p.id, p])), [lookups.products]);
  const deferred = useDeferredValue(draft);
  const result = useMemo(() => landedCostOf(deferred, config, marginPct), [deferred, config, marginPct]);
  const issues = useMemo(() => draftIssues(draft, config), [draft, config]);

  const set = (patch: Partial<ShipmentDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setLine = (key: string, patch: Partial<ShipmentLineDraft>) =>
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const setCost = (key: string, patch: Partial<CostLineDraft>) =>
    setDraft((d) => ({ ...d, costs: d.costs.map((c) => (c.key === key ? { ...c, ...patch } : c)) }));

  const fetchRate = async (target: string, currency: ImportCurrency, date: string | null, apply: (rate: number) => void) => {
    if (currency === "AZN") {
      apply(1);
      return;
    }
    const day = date || new Date().toISOString().slice(0, 10);
    setRateBusy(target);
    const r = await cbarRateAction(currency, day);
    setRateBusy(null);
    if (!r.success) {
      toast(t("imports.rate.failed"), t(r.error), "error");
      return;
    }
    apply(r.data.rate);
    toast(
      t("imports.rate.applied", { currency, rate: r.data.rate }),
      r.data.date !== day ? t("imports.rate.otherDate", { date: formatDate(r.data.date) }) : undefined,
      "success"
    );
  };

  const addProduct = (value: string) => {
    const product = lookups.products.find((p) => `${p.code} · ${p.name}` === value || p.code === value);
    if (!product) return;
    setDraft((d) => ({ ...d, lines: [...d.lines, newLine(product)] }));
    setProductQuery("");
  };

  const save = async () => {
    setShowIssues(true);
    if (issues.length) {
      toast(t("imports.errors.invalid"), issues.map((i) => t(`imports.draftIssues.${i}`)).join(" "), "error");
      return;
    }
    setSaving(true);
    const r = await saveShipmentDraftAction(draft);
    setSaving(false);
    if (!r.success) {
      toast(t("imports.errors.saveFailed"), r.issues?.length ? r.issues.map((i) => t(`imports.draftIssues.${i}`)).join(" ") : t(r.error), "error");
      return;
    }
    toast(t("imports.saved", { number: r.data.number }), undefined, "success");
    await invalidateModel(client, IMPORTS_VIEW_KEY);
    await client.invalidateQueries({ queryKey: ["imports", "shipment", r.data.id] });
    if (!draft.id) router.replace(`/imports/${r.data.id}`);
  };

  const supplierOptions = lookups.suppliers;
  const label = (key: string) => t(`imports.fields.${key}`);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <Link href="/imports" className="ds-btn ds-btn-sm ds-btn-ghost mb-1">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t("imports.backToList")}
          </Link>
          <h1 className="flex flex-wrap items-center gap-2 text-[length:var(--ds-text-xl)] font-semibold">
            {draft.number ?? t("imports.newShipment")}
            <span className="ds-chip ds-chip-flat">{t(`imports.status.${draft.status}`)}</span>
          </h1>
          {view.createdByName || view.createdAt ? (
            <p className="text-[length:var(--ds-text-xs)] ds-muted">
              {t("imports.createdBy", { name: view.createdByName ?? "—", date: view.createdAt ? formatDate(view.createdAt) : "—" })}
            </p>
          ) : null}
        </div>
        {editable ? (
          <button type="button" className="ds-btn ds-btn-primary" onClick={() => void save()} disabled={saving}>
            <Save className="h-4 w-4" aria-hidden />
            {saving ? t("common.saving") : t("imports.saveDraft")}
          </button>
        ) : (
          <span className="flex items-center gap-1.5 text-[length:var(--ds-text-xs)] ds-muted">
            <Lock className="h-3.5 w-3.5" aria-hidden />
            {!view.financials ? t("imports.readOnlyNoFinancials") : draft.status !== "draft" ? t("imports.readOnlyStatus") : t("imports.readOnlyPermission")}
          </span>
        )}
      </header>

      {showIssues && issues.length ? (
        <ul className="ds-card ds-card-pad flex flex-col gap-1" role="alert">
          {issues.map((i) => (
            <li key={i} className="flex items-start gap-1.5 text-[length:var(--ds-text-sm)]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {t(`imports.draftIssues.${i}`)}
            </li>
          ))}
        </ul>
      ) : null}

      <fieldset disabled={!editable} className="contents">
        {/* Header */}
        <section className="ds-card ds-card-pad grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={t("imports.sections.header")}>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="ds-label">{label("supplier")} *</span>
            <select className="ds-input" value={draft.supplierId ?? ""} onChange={(e) => set({ supplierId: e.target.value || null })}>
              <option value="">{t("common.select")}</option>
              {supplierOptions.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="ds-label">{label("currency")}</span>
            <select className="ds-input" value={draft.currencyCode} onChange={(e) => set({ currencyCode: e.target.value as ImportCurrency, ...(e.target.value === "AZN" ? { invoiceRate: 1 } : {}) })}>
              {IMPORT_CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="ds-label">{label("incoterm")}</span>
            <select className="ds-input" value={draft.incoterm ?? ""} onChange={(e) => set({ incoterm: (e.target.value || null) as ShipmentDraft["incoterm"] })}>
              <option value="">—</option>
              {INCOTERMS.map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="ds-label">{label("invoiceNo")}</span>
            <input className="ds-input" value={draft.invoiceNo ?? ""} maxLength={100} onChange={(e) => set({ invoiceNo: e.target.value || null })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="ds-label">{label("invoiceDate")}</span>
            <input className="ds-input" type="date" value={draft.invoiceDate ?? ""} onChange={(e) => set({ invoiceDate: e.target.value || null })} />
          </label>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <span className="ds-label" id="imports-invoice-rate">{label("invoiceRate")} *</span>
            <div className="flex flex-wrap items-center gap-2">
              <NumberField className="w-32" label={label("invoiceRate")} value={draft.invoiceRate} onChange={(v) => set({ invoiceRate: v ?? 0 })} disabled={draft.currencyCode === "AZN" || !editable} />
              <button
                type="button"
                className="ds-btn ds-btn-sm"
                disabled={draft.currencyCode === "AZN" || rateBusy !== null || !editable}
                onClick={() => void fetchRate("invoice", draft.currencyCode, draft.invoiceDate, (rate) => set({ invoiceRate: rate }))}
              >
                <RefreshCw className={`h-4 w-4 ${rateBusy === "invoice" ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden />
                {t("imports.rate.getCbar")}
              </button>
              <span className="text-[length:var(--ds-text-xs)] ds-muted">{t("imports.rate.manualHint")}</span>
            </div>
          </div>
          <label className="flex flex-col gap-1">
            <span className="ds-label">{label("customsDeclarationNo")}</span>
            <input className="ds-input" value={draft.customsDeclarationNo ?? ""} maxLength={100} onChange={(e) => set({ customsDeclarationNo: e.target.value || null })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="ds-label">{label("customsDeclarationDate")}</span>
            <input className="ds-input" type="date" value={draft.customsDeclarationDate ?? ""} onChange={(e) => set({ customsDeclarationDate: e.target.value || null })} />
          </label>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <span className="ds-label">{label("customsRate")}</span>
            <div className="flex flex-wrap items-center gap-2">
              <NumberField className="w-32" label={label("customsRate")} value={draft.customsRate} onChange={(v) => set({ customsRate: v })} disabled={!editable} />
              <button
                type="button"
                className="ds-btn ds-btn-sm"
                disabled={draft.currencyCode === "AZN" || rateBusy !== null || !editable}
                onClick={() => void fetchRate("customs", draft.currencyCode, draft.customsDeclarationDate, (rate) => set({ customsRate: rate }))}
              >
                <RefreshCw className={`h-4 w-4 ${rateBusy === "customs" ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden />
                {t("imports.rate.getCbar")}
              </button>
            </div>
          </div>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="ds-label">{label("defaultWarehouse")}</span>
            <select className="ds-input" value={draft.defaultWarehouseId ?? ""} onChange={(e) => set({ defaultWarehouseId: e.target.value || null })}>
              <option value="">—</option>
              {lookups.warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-4">
            <span className="ds-label">{label("notes")}</span>
            <textarea className="ds-input min-h-[4rem]" value={draft.notes ?? ""} maxLength={10000} onChange={(e) => set({ notes: e.target.value || null })} />
          </label>
        </section>

        {/* Product lines */}
        <section className="ds-card ds-card-pad flex flex-col gap-3" aria-labelledby="imports-lines">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 id="imports-lines" className="font-semibold">{t("imports.sections.lines")}</h2>
            {editable ? (
              <label className="flex items-center gap-2">
                <span className="ds-label">{t("imports.addProduct")}</span>
                <input
                  className="ds-input w-72"
                  list="imports-products"
                  value={productQuery}
                  placeholder={t("imports.addProductPlaceholder")}
                  onChange={(e) => {
                    setProductQuery(e.target.value);
                    addProduct(e.target.value);
                  }}
                />
                <datalist id="imports-products">
                  {lookups.products.map((p) => (
                    <option key={p.id} value={`${p.code} · ${p.name}`} />
                  ))}
                </datalist>
              </label>
            ) : null}
          </div>
          {draft.lines.length === 0 ? (
            <p className="ds-muted">{t("imports.noLines")}</p>
          ) : (
            <div className="overflow-x-auto overscroll-x-contain">
              <table className="w-full min-w-[60rem] border-collapse text-[length:var(--ds-text-sm)]">
                <thead>
                  <tr>
                    {["product", "qtyPurchase", "qtyStock", "unitPriceFc", "lineTotalFc", "weightKg", "volumeM3", "hsCode", "dutyRatePct", "warehouse"].map((k) => (
                      <th key={k} scope="col" className={`px-2 py-1.5 font-semibold ${k === "product" || k === "warehouse" || k === "hsCode" ? "text-start" : "text-end"}`}>
                        {k === "unitPriceFc" || k === "lineTotalFc" ? `${label(k)} (${draft.currencyCode})` : label(k)}
                      </th>
                    ))}
                    <th scope="col"><span className="sr-only">{t("common.actions")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {draft.lines.map((l) => {
                    const p = products.get(l.productId);
                    const name = p ? `${p.code} · ${p.name}` : l.productId;
                    return (
                      <tr key={l.key} style={{ borderTop: "1px solid var(--ds-border)" }}>
                        <th scope="row" className="px-2 py-1.5 text-start font-medium">
                          <span className="block">{p?.name ?? "—"}</span>
                          <span className="block text-[length:var(--ds-text-xs)] font-normal ds-muted ds-mono">{p?.code}</span>
                        </th>
                        <td className="px-2 py-1.5 text-end">
                          <span className="inline-flex items-center gap-1">
                            <NumberField label={`${label("qtyPurchase")}: ${name}`} value={l.qtyPurchase} onChange={(v) => setLine(l.key, { qtyPurchase: v ?? 0, ...(p?.sheetLengthM ? { qtyStock: stockQuantity(v ?? 0, p.sheetLengthM) } : {}) })} disabled={!editable} />
                            <span className="text-[length:var(--ds-text-xs)] ds-muted">{l.purchaseUnit ?? ""}</span>
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-end">
                          {p?.sheetLengthM ? (
                            <span className="ds-mono tabular-nums" title={t("imports.sheetHint", { length: p.sheetLengthM })}>
                              {l.qtyStock} {t("imports.units.metre")}
                            </span>
                          ) : (
                            <NumberField label={`${label("qtyStock")}: ${name}`} value={l.qtyStock} onChange={(v) => setLine(l.key, { qtyStock: v ?? 0 })} disabled={!editable} />
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-end">
                          <NumberField label={`${label("unitPriceFc")}: ${name}`} value={l.unitPriceFc} onChange={(v) => setLine(l.key, { unitPriceFc: v ?? 0 })} disabled={!editable} />
                        </td>
                        <td className="px-2 py-1.5 text-end ds-mono tabular-nums">{round2(l.qtyPurchase * l.unitPriceFc)}</td>
                        <td className="px-2 py-1.5 text-end">
                          <NumberField label={`${label("weightKg")}: ${name}`} value={l.weightKg} onChange={(v) => setLine(l.key, { weightKg: v })} disabled={!editable} />
                        </td>
                        <td className="px-2 py-1.5 text-end">
                          <NumberField className="w-20" label={`${label("volumeM3")}: ${name}`} value={l.volumeM3} onChange={(v) => setLine(l.key, { volumeM3: v })} disabled={!editable} />
                        </td>
                        <td className="px-2 py-1.5">
                          <input className="ds-input ds-mono w-24" aria-label={`${label("hsCode")}: ${name}`} value={l.hsCode ?? ""} maxLength={20} onChange={(e) => setLine(l.key, { hsCode: e.target.value || null })} />
                        </td>
                        <td className="px-2 py-1.5 text-end">
                          <NumberField className="w-16" label={`${label("dutyRatePct")}: ${name}`} value={l.dutyRatePct} onChange={(v) => setLine(l.key, { dutyRatePct: Math.min(100, v ?? 0) })} disabled={!editable} />
                        </td>
                        <td className="px-2 py-1.5">
                          <select className="ds-input" aria-label={`${label("warehouse")}: ${name}`} value={l.warehouseId ?? ""} onChange={(e) => setLine(l.key, { warehouseId: e.target.value || null })}>
                            <option value="">{t("imports.headerWarehouse")}</option>
                            {lookups.warehouses.map((w) => (
                              <option key={w.id} value={w.id}>{w.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1.5 text-end">
                          {editable ? (
                            <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" aria-label={t("imports.removeLine", { name })} onClick={() => setDraft((d) => ({ ...d, lines: d.lines.filter((x) => x.key !== l.key) }))}>
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Cost lines */}
        <section className="ds-card ds-card-pad flex flex-col gap-3" aria-labelledby="imports-costs">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="imports-costs" className="font-semibold">{t("imports.sections.costs")}</h2>
              <p className="text-[length:var(--ds-text-xs)] ds-muted">{t("imports.costsHint")}</p>
            </div>
            {editable ? (
              <label className="flex items-center gap-2">
                <span className="ds-label">{t("imports.addCost")}</span>
                <select
                  className="ds-input"
                  value=""
                  onChange={(e) => {
                    const type = e.target.value as CostType;
                    if (type) setDraft((d) => ({ ...d, costs: [...d.costs, newCost(type, config)] }));
                  }}
                >
                  <option value="">{t("common.select")}</option>
                  {COST_TYPES.map((c) => (
                    <option key={c} value={c}>{costTypeLabel(c, config, t)}</option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          {draft.costs.length === 0 ? (
            <p className="ds-muted">{t("imports.noCosts")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {draft.costs.map((c, index) => (
                <CostRow
                  key={c.key}
                  cost={c}
                  index={index}
                  draft={draft}
                  config={config}
                  lookups={lookups}
                  computedAmount={result.costs[index]?.amountAzn ?? 0}
                  editable={editable}
                  rateBusy={rateBusy === c.key}
                  onChange={(patch) => setCost(c.key, patch)}
                  onRemove={() => setDraft((d) => ({ ...d, costs: d.costs.filter((x) => x.key !== c.key) }))}
                  onFetchRate={() => void fetchRate(c.key, c.currencyCode, draft.customsDeclarationDate || draft.invoiceDate, (rate) => setCost(c.key, { rateToAzn: rate }))}
                />
              ))}
            </ul>
          )}
        </section>
      </fieldset>

      {view.financials ? (
        <LandedCostPanel
          draft={deferred}
          result={result}
          config={config}
          products={products}
          marginPct={marginPct}
          onMarginChange={setMarginPct}
          onUseCustomsVat={
            editable && result.totals.customsVatSuggestionAzn > 0
              ? () => {
                  const existing = draft.costs.find((c) => c.costType === "customs_vat");
                  if (existing) setCost(existing.key, { amount: result.totals.customsVatSuggestionAzn, currencyCode: "AZN", rateToAzn: 1 });
                  else setDraft((d) => ({ ...d, costs: [...d.costs, { ...newCost("customs_vat", config), amount: result.totals.customsVatSuggestionAzn }] }));
                }
              : undefined
          }
        />
      ) : null}

      {draft.id ? (
        <section className="ds-card ds-card-pad" aria-label={t("imports.sections.attachments")}>
          <h2 className="mb-2 font-semibold">{t("imports.sections.attachments")}</h2>
          <RecordChatter model="import_shipments" recordId={draft.id} />
        </section>
      ) : (
        <p className="text-[length:var(--ds-text-xs)] ds-muted">{t("imports.attachmentsAfterSave")}</p>
      )}
    </div>
  );
}

function CostRow({
  cost,
  index,
  draft,
  config,
  lookups,
  computedAmount,
  editable,
  rateBusy,
  onChange,
  onRemove,
  onFetchRate,
}: {
  cost: CostLineDraft;
  index: number;
  draft: ShipmentDraft;
  config: ImportsConfig;
  lookups: ImportLookups;
  computedAmount: number;
  editable: boolean;
  rateBusy: boolean;
  onChange: (patch: Partial<CostLineDraft>) => void;
  onRemove: () => void;
  onFetchRate: () => void;
}) {
  const { t } = useI18n();
  const name = cost.description || `${costTypeLabel(cost.costType, config, t)} ${index + 1}`;
  const duty = cost.splitMethod === "per_line_duty";
  const vat = cost.costType === "customs_vat";
  const f = (key: string) => `${t(`imports.costFields.${key}`)}: ${name}`;
  return (
    <li className="flex flex-col gap-2 p-2" style={{ border: "1px solid var(--ds-border)", borderRadius: "var(--ds-radius-md)" }}>
      <div className="flex flex-wrap items-end gap-2">
        <span className="ds-chip ds-chip-flat">{costTypeLabel(cost.costType, config, t)}</span>
        <input className="ds-input min-w-[10rem] flex-1" aria-label={f("description")} placeholder={t("imports.costFields.description")} value={cost.description ?? ""} maxLength={500} onChange={(e) => onChange({ description: e.target.value || null })} />
        <select className="ds-input" aria-label={f("partner")} value={cost.partnerId ?? ""} onChange={(e) => onChange({ partnerId: e.target.value || null })}>
          <option value="">{t("imports.costFields.noPartner")}</option>
          {lookups.suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        {editable ? (
          <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" aria-label={t("imports.removeCost", { name })} onClick={onRemove}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[length:var(--ds-text-sm)]">
        {duty ? (
          <span className="ds-mono tabular-nums" aria-live="polite">
            {t("imports.costFields.computedDuty", { amount: computedAmount })}
          </span>
        ) : (
          <>
            <NumberField label={f("amount")} value={cost.amount} onChange={(v) => onChange({ amount: v ?? 0 })} disabled={!editable} className="w-28" />
            <select className="ds-input" aria-label={f("currency")} value={cost.currencyCode} onChange={(e) => onChange({ currencyCode: e.target.value as ImportCurrency, ...(e.target.value === "AZN" ? { rateToAzn: 1 } : {}) })}>
              {IMPORT_CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            {cost.currencyCode !== "AZN" ? (
              <span className="inline-flex items-center gap-1">
                <span className="text-[length:var(--ds-text-xs)] ds-muted">{t("imports.costFields.rate")}</span>
                <NumberField label={f("rate")} value={cost.rateToAzn} onChange={(v) => onChange({ rateToAzn: v ?? 0 })} disabled={!editable} />
                <button type="button" className="ds-btn ds-btn-sm" onClick={onFetchRate} disabled={rateBusy || !editable} aria-label={`${t("imports.rate.getCbar")}: ${name}`}>
                  <RefreshCw className={`h-4 w-4 ${rateBusy ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden />
                </button>
              </span>
            ) : null}
          </>
        )}
        {!vat && !duty ? (
          <span className="inline-flex items-center gap-1">
            <span className="text-[length:var(--ds-text-xs)] ds-muted">{t("imports.costFields.vat")}</span>
            <NumberField label={f("vat")} value={cost.vatAmountAzn} onChange={(v) => onChange({ vatAmountAzn: v ?? 0 })} disabled={!editable} />
            {config.costTypes[cost.costType].defaultVatRatePct > 0 && editable ? (
              <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={() => onChange({ vatAmountAzn: suggestedVat(cost, config) })}>
                {t("imports.costFields.vatSuggest", { rate: config.costTypes[cost.costType].defaultVatRatePct })}
              </button>
            ) : null}
          </span>
        ) : null}
        {!vat ? (
          <>
            <label className="inline-flex items-center gap-1">
              <input type="checkbox" checked={cost.isCapitalized} onChange={(e) => onChange({ isCapitalized: e.target.checked })} />
              {t("imports.costFields.capitalized")}
            </label>
            <select className="ds-input" aria-label={f("method")} value={cost.splitMethod} onChange={(e) => onChange({ splitMethod: e.target.value as SplitMethod })} disabled={!cost.isCapitalized || !editable}>
              {methodsFor(cost.costType).map((m) => (
                <option key={m} value={m}>{t(`imports.methods.${m}`)}</option>
              ))}
            </select>
          </>
        ) : (
          <span className="text-[length:var(--ds-text-xs)] ds-muted">{t("imports.costFields.customsVatHint")}</span>
        )}
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" checked={cost.isEstimate} onChange={(e) => onChange({ isEstimate: e.target.checked })} />
          {t("imports.costFields.estimate")}
        </label>
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" checked={cost.paidNow} onChange={(e) => onChange({ paidNow: e.target.checked, ...(e.target.checked ? {} : { cashAccountId: null }) })} />
          {t("imports.costFields.paidNow")}
        </label>
        {cost.paidNow ? (
          <select className="ds-input" aria-label={f("account")} value={cost.cashAccountId ?? ""} onChange={(e) => onChange({ cashAccountId: e.target.value || null })}>
            <option value="">{t("common.select")}</option>
            {lookups.accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        ) : null}
      </div>
      {cost.splitMethod === "manual" && cost.isCapitalized ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("imports.costFields.manualSplit")}>
          {draft.lines.map((l) => {
            const p = lookups.products.find((x) => x.id === l.productId);
            return (
              <label key={l.key} className="inline-flex items-center gap-1 text-[length:var(--ds-text-xs)]">
                <span>{p?.code ?? "—"}</span>
                <NumberField
                  label={`${t("imports.costFields.manualSplit")}: ${p?.name ?? ""}`}
                  value={cost.manual[l.key] ?? 0}
                  onChange={(v) => onChange({ manual: { ...cost.manual, [l.key]: v ?? 0 } })}
                  disabled={!editable}
                />
              </label>
            );
          })}
        </div>
      ) : null}
    </li>
  );
}
