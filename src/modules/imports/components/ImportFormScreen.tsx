"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, BarChart3, ChevronDown, ChevronRight, Lock, Printer, RefreshCw, Save, Settings2, Trash2, Warehouse } from "lucide-react";
import { createPortal } from "react-dom";
import { useDocumentPrint } from "@/hooks/useDocumentPrint";
import {
  Chip,
  Combobox,
  DateField,
  EmptyState,
  Field,
  FormGrid,
  IconButton,
  RowActionsMenu,
  Section,
  SkeletonList,
  useToast,
  useUiStandard,
} from "@/design-system/components";
import { EntityLookup, type LookupRecord } from "@/components/lookups";
import { LookupScope } from "@/components/lookups/LookupScope";
import { comboboxLabels, dateFieldLabels } from "@/i18n/uiStandardLabels";
import { useAuth } from "@/components/auth/AuthProvider";
import { useRecordCrumb } from "@/components/shell/useShell";
import { useI18n } from "@/i18n/I18nProvider";
import { formatMoney } from "@/lib/dates/localeDate";
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
import { plausibilityWarnings } from "../lib/landedChecks";
import { applyHeaderWarehouse } from "../lib/lineWarehouses";
import { cbarKey, customsRateState, rateTargets, setCurrency, setDeclarationDate, typeCustomsRate } from "../lib/rates";
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
import { LandedCostGrid } from "./LandedCostGrid";
import { PostingPanel } from "./PostingPanel";
import CostSheet, { type CostSheetData } from "./CostSheet";
import { ImportLinesGrid } from "./ImportLinesGrid";
import { ImportCostsGrid } from "./ImportCostsGrid";

const LOOKUPS_KEY = ["imports", "lookups"] as const;
const CONFIG_KEY = ["imports", "config"] as const;

async function unwrap<T>(p: Promise<{ success: true; data: T } | { success: false; error: string }>): Promise<T> {
  const r = await p;
  if (!r.success) throw new Error(r.error);
  return r.data;
}

/** A record created in a lookup, in the shape the import lookups keep (UI-2 lookups). */
function importProductOf(row: LookupRecord): ImportLookups["products"][number] {
  return {
    id: row.id,
    code: String(row.code ?? ""),
    name: String(row.name ?? ""),
    unit: (row.unit as string | null) ?? null,
    sheetLengthM: row.inventory_mode === "polywood" && Number(row.full_sheet_length_m) > 0 ? Number(row.full_sheet_length_m) : null,
    barcode: (row.barcode as string | null) ?? null,
  };
}

function supplierNameOf(row: LookupRecord): string {
  return String(row.company_name || row.full_name || "");
}

const today = () => new Date().toISOString().slice(0, 10);

/** One import shipment (IMP-1 … IMP-4): header, rates, product lines, costs and the live landed cost. id "new" = a new draft. */
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
  return <ImportShipmentForm key={`${id}-${shipment.dataUpdatedAt}`} view={view} lookups={lookups.data} config={config.data} />;
}

/** A number field that keeps what is typed ("1," or "0.") and reports the parsed value. */
function NumberField({
  value,
  onChange,
  label,
  className = "w-24",
  min = 0,
  disabled,
  id,
  describedBy,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  label: string;
  className?: string;
  min?: number;
  disabled?: boolean;
  id?: string;
  describedBy?: string;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    if (Number(text.replace(",", ".")) !== value) setText(value === null ? "" : String(value));
  }
  return (
    <input
      id={id}
      className={`ds-input ds-mono tabular-nums ${className}`}
      inputMode="decimal"
      type="text"
      aria-label={label}
      aria-describedby={describedBy}
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

/** The form itself (also the UI lab's ?frame=import, with sample data). */
export function ImportShipmentForm({ view, lookups, config }: { view: ShipmentView; lookups: ImportLookups; config: ImportsConfig }) {
  const { t, formatDate, locale } = useI18n();
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
  const [showIssues, setShowIssues] = useState(false);
  const [tab, setTab] = useState<"general" | "landed">("general");
  const [notesOpen, setNotesOpen] = useState(() => !!view.draft.notes);
  // CBAR rates seen this session (currency:date → rate), for the "rate is far from CBAR" warning.
  const [cbarSeen, setCbarSeen] = useState<Record<string, number>>({});
  const uiStandard = useUiStandard();
  useRecordCrumb(draft.number ?? t("imports.newShipment"));

  // UI-2 lookups: a record picked or created in a lookup joins the loaded lookups, so names,
  // the posting panel and the cost sheet know it without a reload (the form keeps its state).
  const remember = (patch: { supplier?: LookupRecord; product?: LookupRecord; warehouse?: LookupRecord; account?: LookupRecord }) => {
    client.setQueryData<ImportLookups>(LOOKUPS_KEY, (prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      if (patch.supplier && !prev.suppliers.some((x) => x.id === patch.supplier!.id)) next.suppliers = [{ id: patch.supplier.id, name: supplierNameOf(patch.supplier) }, ...prev.suppliers];
      if (patch.product && !prev.products.some((x) => x.id === patch.product!.id)) next.products = [importProductOf(patch.product), ...prev.products];
      if (patch.warehouse && !prev.warehouses.some((x) => x.id === patch.warehouse!.id)) next.warehouses = [...prev.warehouses, { id: patch.warehouse.id, name: String(patch.warehouse.name ?? ""), isDefault: false }];
      if (patch.account && !prev.accounts.some((x) => x.id === patch.account!.id)) next.accounts = [...prev.accounts, { id: patch.account.id, name: [patch.account.code, patch.account.name].filter(Boolean).join(" · ") }];
      return next;
    });
  };

  const editable = draft.status === "draft" && view.financials && can("can_manage_imports");
  const products = useMemo(() => new Map(lookups.products.map((p) => [p.id, p])), [lookups.products]);
  const sheetLengths = useMemo(() => new Map(lookups.products.map((p) => [p.id, p.sheetLengthM])), [lookups.products]);
  const deferred = useDeferredValue(draft);
  const result = useMemo(() => landedCostOf(deferred, config, marginPct), [deferred, config, marginPct]);
  const issues = useMemo(() => draftIssues(draft, config, sheetLengths), [draft, config, sheetLengths]);
  const plausibility = useMemo(() => plausibilityWarnings(deferred, result, cbarSeen), [deferred, result, cbarSeen]);
  // Unsaved changes: posting waits for a save (IMP-2 posts the stored shipment).
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(view.draft), [draft, view.draft]);
  const warehouseNames = useMemo(() => Object.fromEntries(lookups.warehouses.map((w) => [w.id, w.name])), [lookups.warehouses]);
  // IMP-3: the shipment cost sheet (A4) of the saved shipment.
  const { printData: costSheet, setPrintData: setCostSheet } = useDocumentPrint<CostSheetData>(300);
  const printCostSheet = () =>
    setCostSheet({
      draft: view.draft,
      result: landedCostOf(view.draft, config),
      config,
      products,
      supplierName: lookups.suppliers.find((s) => s.id === view.draft.supplierId)?.name ?? "",
      warehouseNames,
    });

  const set = (patch: Partial<ShipmentDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setLine = (key: string, patch: Partial<ShipmentLineDraft>) =>
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const setCost = (key: string, patch: Partial<CostLineDraft>) =>
    setDraft((d) => ({ ...d, costs: d.costs.map((c) => (c.key === key ? { ...c, ...patch } : c)) }));

  /** Asks CBAR for one rate; remembers it for the plausibility check. Returns the rate or null. */
  const askCbar = async (target: string, currency: ImportCurrency, date: string | null, quiet = false): Promise<number | null> => {
    if (currency === "AZN") return 1;
    const day = date || today();
    setRateBusy(target);
    const r = await cbarRateAction(currency, day);
    setRateBusy(null);
    if (!r.success) {
      if (!quiet) toast(t("imports.rate.failed"), t(r.error), "error");
      return null;
    }
    setCbarSeen((s) => ({ ...s, [cbarKey(currency, day)]: r.data.rate }));
    if (!quiet) {
      toast(
        t("imports.rate.applied", { currency, rate: r.data.rate }),
        r.data.date !== day ? t("imports.rate.otherDate", { date: formatDate(r.data.date) }) : undefined,
        "success"
      );
    }
    return r.data.rate;
  };
  const fetchRate = async (target: string, currency: ImportCurrency, date: string | null, apply: (rate: number) => void) => {
    const rate = await askCbar(target, currency, date);
    if (rate !== null) apply(rate);
  };
  const fetchCostRate = (c: CostLineDraft) =>
    void fetchRate(c.key, c.currencyCode, draft.customsDeclarationDate || draft.invoiceDate, (rate) => setCost(c.key, { rateToAzn: rate }));
  /** "Refresh all rates": the invoice, the customs (once dated) and every foreign-currency cost. */
  const refreshAll = async () => {
    const targets = rateTargets(draft, today());
    let done = 0;
    for (const target of targets) {
      const rate = await askCbar("all", target.currency, target.date, true);
      if (rate === null) continue;
      done += 1;
      if (target.target === "invoice") set({ invoiceRate: rate });
      else if (target.target === "customs") setDraft((d) => typeCustomsRate(d, rate));
      else setCost(target.target, { rateToAzn: rate });
    }
    toast(done === targets.length ? t("imports.rates.refreshed", { count: done }) : t("imports.rates.refreshedSome", { done, total: targets.length }), undefined, done === targets.length ? "success" : "error");
  };
  const changeDeclarationDate = (date: string | null) => {
    const next = setDeclarationDate(draft, date);
    setDraft(next.draft);
    // While the customs rate follows the invoice, a declaration date brings its own CBAR rate.
    if (next.fetchCustomsRate && date) void fetchRate("customs", draft.currencyCode, date, (rate) => setDraft((d) => typeCustomsRate(d, rate)));
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

  const applyCustomsVat =
    editable && result.totals.customsVatSuggestionAzn > 0
      ? () => {
          const existing = draft.costs.find((c) => c.costType === "customs_vat");
          if (existing) setCost(existing.key, { amount: result.totals.customsVatSuggestionAzn, currencyCode: "AZN", rateToAzn: 1 });
          else setDraft((d) => ({ ...d, costs: [...d.costs, { ...newCost("customs_vat", config), amount: result.totals.customsVatSuggestionAzn }] }));
        }
      : undefined;

  const label = (key: string) => t(`imports.fields.${key}`);
  const supplierName = lookups.suppliers.find((x) => x.id === draft.supplierId)?.name;
  const readOnlyNote = !view.financials ? t("imports.readOnlyNoFinancials") : draft.status !== "draft" ? t("imports.readOnlyStatus") : t("imports.readOnlyPermission");
  const issueList =
    showIssues && issues.length ? (
      <ul className="ds-card ds-card-pad flex flex-col gap-1" role="alert">
        {issues.map((i) => (
          <li key={i} className="flex items-start gap-1.5 text-[length:var(--ds-text-sm)]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {t(`imports.draftIssues.${i}`)}
          </li>
        ))}
      </ul>
    ) : null;
  const printOverlay = costSheet ? createPortal(<div className="print-area"><CostSheet data={costSheet} /></div>, document.body) : null;
  const postingPanel = view.draft.id && view.financials ? <PostingPanel draft={view.draft} lookups={lookups} config={config} dirty={dirty} /> : null;
  const chatter = draft.id ? (
    <section className="ds-card ds-card-pad" aria-label={t("imports.sections.attachments")}>
      <h2 className="mb-2 font-semibold">{t("imports.sections.attachments")}</h2>
      <RecordChatter model="import_shipments" recordId={draft.id} />
    </section>
  ) : (
    <p className="text-[length:var(--ds-text-xs)] ds-muted">{t("imports.attachmentsAfterSave")}</p>
  );

  // ── UI standard (IMP-4) ───────────────────────────────────────────────────
  if (uiStandard) {
    const customs = customsRateState(draft);
    const foreign = draft.currencyCode !== "AZN";
    const rateOff = (which: string) => plausibility.some((p) => p.code === "rate_off_cbar" && p.rate === which);
    const capitalTotal = result.totals.capitalizedAzn;
    const vatTotal = result.totals.recoverableVatAzn;
    const money = (n: number) => formatMoney(n, locale, { currency: "AZN" });
    return (
      <LookupScope>
        <div className="flex flex-col gap-4">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <Link href="/imports" className="ds-btn ds-btn-sm ds-btn-ghost self-start">
                <ArrowLeft className="h-4 w-4" aria-hidden />
                {t("imports.backToList")}
              </Link>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h1 className="truncate text-[length:var(--ds-text-xl)] font-semibold">{draft.number ?? t("imports.newShipment")}</h1>
                <Chip tone={draft.status === "draft" ? "neutral" : draft.status === "cancelled" ? "danger" : draft.status === "received" || draft.status === "closed" ? "success" : "info"}>
                  {t(`imports.status.${draft.status}`)}
                </Chip>
                {supplierName ? (
                  <span className="truncate text-[length:var(--ds-text-sm)] ds-muted">
                    {supplierName}
                    {draft.invoiceNo ? ` · ${t("imports.invoiceShort", { no: draft.invoiceNo })}` : ""}
                  </span>
                ) : null}
              </div>
              {view.createdByName || view.createdAt ? (
                <p className="text-[length:var(--ds-text-xs)] ds-muted">
                  {t("imports.createdByLong", { name: view.createdByName ?? "—", date: view.createdAt ? formatDate(view.createdAt) : "—" })}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {editable ? (
                <button type="button" className="ds-btn ds-btn-primary" onClick={() => void save()} disabled={saving}>
                  <Save className="h-4 w-4" aria-hidden />
                  {saving ? t("common.saving") : t("imports.saveDraft")}
                </button>
              ) : (
                <span className="flex items-center gap-1.5 text-[length:var(--ds-text-xs)] ds-muted">
                  <Lock className="h-3.5 w-3.5" aria-hidden />
                  {readOnlyNote}
                </span>
              )}
              {view.draft.id && view.financials ? (
                <button type="button" className="ds-btn" onClick={printCostSheet} disabled={dirty} title={dirty ? t("importPosting.saveFirst") : undefined}>
                  <Printer className="h-4 w-4" aria-hidden />
                  {t("importReports.costSheet.print")}
                </button>
              ) : null}
              <RowActionsMenu
                label={t("imports.moreActions")}
                linkAs={Link}
                items={[
                  { key: "reports", label: t("importReports.title"), icon: <BarChart3 className="h-4 w-4" />, href: "/imports/reports" },
                  { key: "settings", label: t("imports.settings.title"), icon: <Settings2 className="h-4 w-4" />, href: "/settings/imports" },
                ]}
              />
            </div>
          </header>

          {issueList}

          <div className="ds-doc-tabs" role="tablist" aria-label={t("imports.tabs.label")}>
            {(["general", "landed"] as const).map((k) => (
              <button key={k} type="button" role="tab" id={`imports-tab-${k}`} aria-selected={tab === k} aria-controls={`imports-panel-${k}`} className="ds-tab" onClick={() => setTab(k)}>
                {t(`imports.tabs.${k}`)}
                {k === "landed" && result.errors.length ? <AlertTriangle className="h-3.5 w-3.5" aria-label={t("imports.tabs.hasErrors")} style={{ color: "var(--ds-danger-strong)" }} /> : null}
              </button>
            ))}
          </div>

          {tab === "general" ? (
            <div role="tabpanel" id="imports-panel-general" aria-labelledby="imports-tab-general" className="flex flex-col gap-4">
              <Section title={t("imports.sections.main")} description={editable ? undefined : readOnlyNote}>
                <FormGrid columns={4}>
                  <Field label={label("supplier")} required span={2}>
                    {({ id }) => (
                      <EntityLookup
                        id={id}
                        entity="supplier"
                        width="full"
                        value={draft.supplierId}
                        selectedLabel={supplierName}
                        invalid={showIssues && issues.includes("supplier_required")}
                        onChange={(sid, row) => {
                          if (row) remember({ supplier: row });
                          set({ supplierId: sid });
                        }}
                        disabled={!editable}
                        aria-label={label("supplier")}
                      />
                    )}
                  </Field>
                  <Field label={label("currency")}>
                    {({ id }) => (
                      <Combobox
                        id={id}
                        value={draft.currencyCode}
                        onChange={(next) => next && setDraft((d) => setCurrency(d, next as ImportCurrency))}
                        options={IMPORT_CURRENCIES.map((c) => ({ value: c, label: c }))}
                        labels={comboboxLabels(t)}
                        locale={locale}
                        clearable={false}
                        disabled={!editable}
                        width="full"
                        aria-label={label("currency")}
                      />
                    )}
                  </Field>
                  <Field label={label("incoterm")}>
                    {({ id }) => (
                      <Combobox
                        id={id}
                        value={draft.incoterm ?? null}
                        onChange={(next) => set({ incoterm: (next || null) as ShipmentDraft["incoterm"] })}
                        options={INCOTERMS.map((i) => ({ value: i, label: i }))}
                        labels={comboboxLabels(t)}
                        locale={locale}
                        disabled={!editable}
                        width="full"
                        aria-label={label("incoterm")}
                      />
                    )}
                  </Field>
                  <Field label={label("invoiceNo")}>
                    {({ id }) => <input id={id} className="ds-input" value={draft.invoiceNo ?? ""} maxLength={100} disabled={!editable} onChange={(e) => set({ invoiceNo: e.target.value || null })} />}
                  </Field>
                  <Field label={label("invoiceDate")}>
                    {({ id }) => (
                      <DateField id={id} value={draft.invoiceDate ?? null} onChange={(v) => set({ invoiceDate: v })} locale={locale} labels={dateFieldLabels(t)} disabled={!editable} width="full" aria-label={label("invoiceDate")} />
                    )}
                  </Field>
                  <Field label={label("defaultWarehouse")} hint={t("imports.defaultWarehouseHint")} span={2}>
                    {({ id }) => (
                        <EntityLookup
                          id={id}
                          entity="warehouse"
                          width="full"
                          value={draft.defaultWarehouseId}
                          selectedLabel={warehouseNames[draft.defaultWarehouseId ?? ""]}
                          onChange={(wid, row) => {
                            if (row) remember({ warehouse: row });
                            set({ defaultWarehouseId: wid });
                          }}
                          disabled={!editable}
                          aria-label={label("defaultWarehouse")}
                        />
                    )}
                  </Field>
                  <div className="col-span-full">
                    <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" aria-expanded={notesOpen} aria-controls="imports-notes" onClick={() => setNotesOpen((o) => !o)}>
                      {notesOpen ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
                      {label("notes")}
                      {!notesOpen && draft.notes ? <span className="max-w-[24rem] truncate ds-muted">· {draft.notes}</span> : null}
                    </button>
                    {notesOpen ? (
                      <textarea
                        id="imports-notes"
                        className="ds-input mt-1 min-h-[4rem] w-full"
                        aria-label={label("notes")}
                        value={draft.notes ?? ""}
                        maxLength={10000}
                        disabled={!editable}
                        onChange={(e) => set({ notes: e.target.value || null })}
                      />
                    ) : null}
                  </div>
                </FormGrid>
              </Section>

              <Section
                title={t("imports.rates.title")}
                description={foreign ? t("imports.rates.hint") : t("imports.rates.aznHint")}
                actions={
                  editable && foreign ? (
                    <button type="button" className="ds-btn ds-btn-sm" disabled={rateBusy !== null} onClick={() => void refreshAll()}>
                      <RefreshCw className={`h-4 w-4 ${rateBusy === "all" ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden />
                      {t("imports.rates.refreshAll")}
                    </button>
                  ) : null
                }
              >
                <FormGrid columns={4}>
                  {foreign ? (
                    <>
                      <Field
                        label={`${t("imports.rates.invoice")} (${draft.currencyCode} → AZN)`}
                        required
                        hint={rateOff("invoice") ? t("imports.plausibility.rate_off_cbar") : draft.invoiceDate ? t("imports.rates.forDate", { date: formatDate(draft.invoiceDate) }) : t("imports.rates.noDate")}
                        error={showIssues && issues.includes("rate_required") ? t("imports.draftIssues.rate_required") : null}
                      >
                        {({ id, describedBy }) => (
                          <span className="ds-rate-field">
                            <NumberField id={id} describedBy={describedBy} className="w-full" label={t("imports.rates.invoice")} value={draft.invoiceRate} onChange={(v) => set({ invoiceRate: v ?? 0 })} disabled={!editable} />
                            {editable ? (
                              <IconButton
                                size="sm"
                                label={t("imports.rates.fetchFor", { date: draft.invoiceDate ? formatDate(draft.invoiceDate) : t("imports.rates.today") })}
                                icon={<RefreshCw className={`h-4 w-4 ${rateBusy === "invoice" ? "animate-spin motion-reduce:animate-none" : ""}`} />}
                                disabled={rateBusy !== null}
                                onClick={() => void fetchRate("invoice", draft.currencyCode, draft.invoiceDate, (rate) => set({ invoiceRate: rate }))}
                              />
                            ) : null}
                          </span>
                        )}
                      </Field>
                      <Field
                        label={`${t("imports.rates.customs")} (${draft.currencyCode} → AZN)`}
                        hint={
                          rateOff("customs")
                            ? t("imports.plausibility.rate_off_cbar")
                            : customs.source === "invoice"
                              ? `${t("imports.rates.fromInvoice")}: ${t("imports.rates.followsInvoice")}`
                              : draft.customsDeclarationDate
                                ? t("imports.rates.forDate", { date: formatDate(draft.customsDeclarationDate) })
                                : t("imports.rates.typed")
                        }
                      >
                        {({ id, describedBy }) => (
                          <span className="ds-rate-field">
                            <NumberField
                              id={id}
                              describedBy={describedBy}
                              className="w-full"
                              label={t("imports.rates.customs")}
                              value={customs.rate}
                              onChange={(v) => setDraft((d) => typeCustomsRate(d, v))}
                              disabled={!editable}
                            />
                            {editable ? (
                              <IconButton
                                size="sm"
                                label={draft.customsDeclarationDate ? t("imports.rates.fetchFor", { date: formatDate(draft.customsDeclarationDate) }) : t("imports.rates.customsNeedsDate")}
                                icon={<RefreshCw className={`h-4 w-4 ${rateBusy === "customs" ? "animate-spin motion-reduce:animate-none" : ""}`} />}
                                disabled={rateBusy !== null || !draft.customsDeclarationDate}
                                onClick={() => void fetchRate("customs", draft.currencyCode, draft.customsDeclarationDate, (rate) => setDraft((d) => typeCustomsRate(d, rate)))}
                              />
                            ) : null}
                          </span>
                        )}
                      </Field>
                    </>
                  ) : null}
                  <Field label={label("customsDeclarationNo")}>
                    {({ id }) => (
                      <input id={id} className="ds-input" value={draft.customsDeclarationNo ?? ""} maxLength={100} placeholder={t("imports.rates.declarationLater")} disabled={!editable} onChange={(e) => set({ customsDeclarationNo: e.target.value || null })} />
                    )}
                  </Field>
                  <Field label={label("customsDeclarationDate")}>
                    {({ id }) => (
                      <DateField id={id} value={draft.customsDeclarationDate ?? null} onChange={changeDeclarationDate} locale={locale} labels={dateFieldLabels(t)} disabled={!editable} width="full" aria-label={label("customsDeclarationDate")} />
                    )}
                  </Field>
                </FormGrid>
              </Section>

              <Section
                title={`${t("imports.sections.lines")} · ${draft.lines.length}`}
                actions={
                  editable && draft.lines.length ? (
                    <button
                      type="button"
                      className="ds-btn ds-btn-sm"
                      disabled={!draft.defaultWarehouseId}
                      title={t("imports.applyWarehouseHint", { name: warehouseNames[draft.defaultWarehouseId ?? ""] ?? "—" })}
                      onClick={() => setDraft((d) => ({ ...d, lines: applyHeaderWarehouse(d.lines, d.defaultWarehouseId) }))}
                    >
                      <Warehouse className="h-4 w-4" aria-hidden />
                      {t("imports.applyWarehouse")}
                    </button>
                  ) : null
                }
              >
                <ImportLinesGrid
                  draft={draft}
                  setDraft={setDraft}
                  editable={editable}
                  products={products}
                  lookups={lookups}
                  showIssues={showIssues}
                  importProductOf={importProductOf}
                  onRemember={remember}
                  result={result}
                  splitsAvailable={view.splitsAvailable !== false}
                />
              </Section>

              <Section
                title={t("imports.sections.costs")}
                description={t("imports.costsSummary", { capitalized: money(capitalTotal), vat: money(vatTotal) })}
              >
                <ImportCostsGrid
                  draft={draft}
                  setDraft={setDraft}
                  editable={editable}
                  config={config}
                  lookups={lookups}
                  result={result}
                  plausibility={plausibility}
                  rateBusy={rateBusy}
                  onFetchRate={fetchCostRate}
                  onRemember={remember}
                />
              </Section>

              {postingPanel}
              {chatter}
            </div>
          ) : (
            <div role="tabpanel" id="imports-panel-landed" aria-labelledby="imports-tab-landed">
              {view.financials ? (
                <LandedCostGrid
                  draft={deferred}
                  result={result}
                  config={config}
                  products={products}
                  marginPct={marginPct}
                  onMarginChange={setMarginPct}
                  onUseCustomsVat={applyCustomsVat}
                  plausibility={plausibility}
                />
              ) : (
                <p className="ds-muted">{t("imports.readOnlyNoFinancials")}</p>
              )}
            </div>
          )}

          {printOverlay}
        </div>
      </LookupScope>
    );
  }

  // ── Flag off: the IMP-1 layout (the same lookups and pickers, no native controls) ──
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
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/imports/reports" className="ds-btn ds-btn-sm ds-btn-ghost">
            <BarChart3 className="h-4 w-4" aria-hidden />
            {t("importReports.title")}
          </Link>
          {view.draft.id && view.financials ? (
            <button type="button" className="ds-btn ds-btn-sm" onClick={printCostSheet} disabled={dirty} title={dirty ? t("importPosting.saveFirst") : undefined}>
              <Printer className="h-4 w-4" aria-hidden />
              {t("importReports.costSheet.print")}
            </button>
          ) : null}
          {editable ? (
            <button type="button" className="ds-btn ds-btn-primary" onClick={() => void save()} disabled={saving}>
              <Save className="h-4 w-4" aria-hidden />
              {saving ? t("common.saving") : t("imports.saveDraft")}
            </button>
          ) : (
            <span className="flex items-center gap-1.5 text-[length:var(--ds-text-xs)] ds-muted">
              <Lock className="h-3.5 w-3.5" aria-hidden />
              {readOnlyNote}
            </span>
          )}
        </div>
      </header>

      {issueList}

      <fieldset disabled={!editable} className="contents">
        {/* Header */}
        <section className="ds-card ds-card-pad grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={t("imports.sections.header")}>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="ds-label">{label("supplier")} *</span>
            <EntityLookup
              entity="supplier"
              value={draft.supplierId}
              selectedLabel={supplierName}
              onChange={(sid, row) => {
                if (row) remember({ supplier: row });
                set({ supplierId: sid });
              }}
              disabled={!editable}
              aria-label={label("supplier")}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="ds-label">{label("currency")}</span>
            <Combobox
              value={draft.currencyCode}
              onChange={(next) => next && setDraft((d) => setCurrency(d, next as ImportCurrency))}
              options={IMPORT_CURRENCIES.map((c) => ({ value: c, label: c }))}
              labels={comboboxLabels(t)}
              locale={locale}
              clearable={false}
              disabled={!editable}
              width="full"
              aria-label={label("currency")}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="ds-label">{label("incoterm")}</span>
            <Combobox
              value={draft.incoterm ?? null}
              onChange={(next) => set({ incoterm: (next || null) as ShipmentDraft["incoterm"] })}
              options={INCOTERMS.map((i) => ({ value: i, label: i }))}
              labels={comboboxLabels(t)}
              locale={locale}
              disabled={!editable}
              width="full"
              aria-label={label("incoterm")}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="ds-label">{label("invoiceNo")}</span>
            <input className="ds-input" value={draft.invoiceNo ?? ""} maxLength={100} onChange={(e) => set({ invoiceNo: e.target.value || null })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="ds-label">{label("invoiceDate")}</span>
            <DateField value={draft.invoiceDate ?? null} onChange={(v) => set({ invoiceDate: v })} locale={locale} labels={dateFieldLabels(t)} disabled={!editable} width="full" aria-label={label("invoiceDate")} />
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
            <DateField value={draft.customsDeclarationDate ?? null} onChange={changeDeclarationDate} locale={locale} labels={dateFieldLabels(t)} disabled={!editable} width="full" aria-label={label("customsDeclarationDate")} />
          </label>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <span className="ds-label">{label("customsRate")}</span>
            <div className="flex flex-wrap items-center gap-2">
              <NumberField className="w-32" label={label("customsRate")} value={draft.customsRate} onChange={(v) => setDraft((d) => typeCustomsRate(d, v))} disabled={!editable} />
              <button
                type="button"
                className="ds-btn ds-btn-sm"
                disabled={draft.currencyCode === "AZN" || rateBusy !== null || !editable}
                onClick={() => void fetchRate("customs", draft.currencyCode, draft.customsDeclarationDate, (rate) => setDraft((d) => typeCustomsRate(d, rate)))}
              >
                <RefreshCw className={`h-4 w-4 ${rateBusy === "customs" ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden />
                {t("imports.rate.getCbar")}
              </button>
              {draft.customsRate === null && draft.currencyCode !== "AZN" ? <span className="text-[length:var(--ds-text-xs)] ds-muted">{t("imports.rates.followsInvoice")}</span> : null}
            </div>
          </div>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="ds-label">{label("defaultWarehouse")}</span>
            <EntityLookup
              entity="warehouse"
              value={draft.defaultWarehouseId}
              selectedLabel={warehouseNames[draft.defaultWarehouseId ?? ""]}
              onChange={(wid, row) => {
                if (row) remember({ warehouse: row });
                set({ defaultWarehouseId: wid });
              }}
              disabled={!editable}
              aria-label={label("defaultWarehouse")}
            />
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
                <EntityLookup
                  entity="product"
                  value={null}
                  where={{ is_service: false, is_composite: false }}
                  placeholder={t("imports.addProductPlaceholder")}
                  width="lg"
                  scanBarcodes
                  onChange={(_pid, row) => {
                    if (!row) return;
                    remember({ product: row });
                    setDraft((d) => ({ ...d, lines: [...d.lines, newLine(products.get(row.id) ?? importProductOf(row))] }));
                  }}
                  aria-label={t("imports.addProduct")}
                />
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
                          {l.warehouses.length ? (
                            <span className="ds-muted" title={l.warehouses.map((s) => `${warehouseNames[s.warehouseId ?? ""] ?? "—"}: ${s.qtyPurchase}`).join("\n")}>
                              {t("imports.whSplit.count", { count: l.warehouses.length })}
                            </span>
                          ) : (
                            <EntityLookup
                              entity="warehouse"
                              size="sm"
                              width="md"
                              value={l.warehouseId}
                              selectedLabel={warehouseNames[l.warehouseId ?? ""]}
                              placeholder={warehouseNames[draft.defaultWarehouseId ?? ""] ?? t("imports.headerWarehouse")}
                              onChange={(wid, row) => {
                                if (row) remember({ warehouse: row });
                                setLine(l.key, { warehouseId: wid });
                              }}
                              disabled={!editable}
                              aria-label={`${label("warehouse")}: ${name}`}
                            />
                          )}
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
              <Combobox
                value={null}
                onChange={(next) => {
                  if (next) setDraft((d) => ({ ...d, costs: [...d.costs, newCost(next as CostType, config)] }));
                }}
                options={COST_TYPES.map((c) => ({ value: c, label: costTypeLabel(c, config, t) }))}
                labels={{ ...comboboxLabels(t), placeholder: t("imports.addCost") }}
                locale={locale}
                clearable={false}
                width="md"
                aria-label={t("imports.addCost")}
              />
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
                  unallocated={result.errors.some((e) => e.code === "zero_basis" && e.costId === c.key)}
                  onChange={(patch) => setCost(c.key, patch)}
                  onRemove={() => setDraft((d) => ({ ...d, costs: d.costs.filter((x) => x.key !== c.key) }))}
                  onFetchRate={() => fetchCostRate(c)}
                  onRemember={remember}
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
          onUseCustomsVat={applyCustomsVat}
        />
      ) : null}

      {printOverlay}
      {postingPanel}
      {chatter}
    </div>
  );
}

/** One cost of the flag-off layout (IMP-1 card), with the standard pickers. */
function CostRow({
  cost,
  index,
  draft,
  config,
  lookups,
  computedAmount,
  editable,
  rateBusy,
  unallocated,
  onChange,
  onRemove,
  onFetchRate,
  onRemember,
}: {
  cost: CostLineDraft;
  index: number;
  draft: ShipmentDraft;
  config: ImportsConfig;
  lookups: ImportLookups;
  computedAmount: number;
  editable: boolean;
  rateBusy: boolean;
  /** IMP-4: nothing to split this cost by; saving is blocked. */
  unallocated: boolean;
  onChange: (patch: Partial<CostLineDraft>) => void;
  onRemove: () => void;
  onFetchRate: () => void;
  onRemember: (patch: { supplier?: LookupRecord; account?: LookupRecord }) => void;
}) {
  const { t, locale } = useI18n();
  const name = cost.description || `${costTypeLabel(cost.costType, config, t)} ${index + 1}`;
  const duty = cost.splitMethod === "per_line_duty";
  const vat = cost.costType === "customs_vat";
  const f = (key: string) => `${t(`imports.costFields.${key}`)}: ${name}`;
  return (
    <li className="flex flex-col gap-2 p-2" style={{ border: `1px solid ${unallocated ? "var(--ds-danger, #e11d48)" : "var(--ds-border)"}`, borderRadius: "var(--ds-radius-md)" }}>
      <div className="flex flex-wrap items-end gap-2">
        <span className="ds-chip ds-chip-flat">{costTypeLabel(cost.costType, config, t)}</span>
        <input className="ds-input min-w-[10rem] flex-1" aria-label={f("description")} placeholder={t("imports.costFields.description")} value={cost.description ?? ""} maxLength={500} onChange={(e) => onChange({ description: e.target.value || null })} />
        {/* "Paid to": carriers, customs offices and brokers are suppliers; a missing one is created here. */}
        <span className="inline-flex min-w-0 items-center gap-1" title={t("lookup.audit.paidToHint")}>
          <span className="ds-label shrink-0">{t("lookup.audit.paidTo")}</span>
          <EntityLookup
            entity="supplier"
            value={cost.partnerId}
            selectedLabel={lookups.suppliers.find((x) => x.id === cost.partnerId)?.name}
            placeholder={t("imports.costFields.noPartner")}
            onChange={(id, row) => {
              if (row) onRemember({ supplier: row });
              onChange({ partnerId: id });
            }}
            disabled={!editable}
            width="lg"
            aria-label={f("partner")}
          />
        </span>
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
            <Combobox
              value={cost.currencyCode}
              onChange={(next) => next && onChange({ currencyCode: next as ImportCurrency, ...(next === "AZN" ? { rateToAzn: 1 } : {}) })}
              options={IMPORT_CURRENCIES.map((c) => ({ value: c, label: c }))}
              labels={comboboxLabels(t)}
              locale={locale}
              clearable={false}
              disabled={!editable}
              width="xs"
              aria-label={f("currency")}
            />
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
            <Combobox
              value={cost.splitMethod}
              onChange={(next) => next && onChange({ splitMethod: next as SplitMethod })}
              options={methodsFor(cost.costType).map((m) => ({ value: m, label: t(`imports.methods.${m}`) }))}
              labels={comboboxLabels(t)}
              locale={locale}
              clearable={false}
              disabled={!cost.isCapitalized || !editable}
              width="md"
              aria-label={f("method")}
            />
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
          <EntityLookup
            entity="account"
            value={cost.cashAccountId}
            selectedLabel={lookups.accounts.find((a) => a.id === cost.cashAccountId)?.name}
            onChange={(id, row) => {
              if (row) onRemember({ account: row });
              onChange({ cashAccountId: id });
            }}
            disabled={!editable}
            width="md"
            aria-label={f("account")}
          />
        ) : null}
      </div>
      {unallocated ? (
        <p className="text-[length:var(--ds-text-xs)]" role="alert" style={{ color: "var(--ds-danger, #e11d48)" }}>
          {t("imports.draftIssues.cost_unallocated")}
        </p>
      ) : null}
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
