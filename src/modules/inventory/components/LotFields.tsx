"use client";

import { useId } from "react";
import Link from "next/link";
import { Plus, Split, Trash2 } from "lucide-react";
import { LineTextCell, type LineCellContext, type LineColumn } from "@/components/line-grid";
import BarcodeDisplay from "@/components/products/BarcodeDisplay";
import QrCodeImage from "@/components/products/QrCodeImage";
import { DateField, Field } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { dateFieldLabels } from "@/i18n/uiStandardLabels";
import {
  addLot,
  lotHref,
  lotIssues,
  lotQuantities,
  lotSplitIssue,
  normalizeLot,
  removeLot,
  LOT_NO_MAX,
  type LotFieldsValue,
  type LotPolicy,
  type LotSplitRow,
} from "../lib/lotFields";

type T = (key: string, params?: Record<string, string | number>) => string;

/**
 * LOT-2: the lot fields of an inbound line (lot number, supplier batch, production and expiry
 * date), one typed set of components for imports, purchases and the initial balance. Imported by
 * other modules only through `@/modules/inventory`.
 */
export function LotFieldsEditor({
  value,
  onChange,
  policy,
  disabled,
  autoPlaceholder = true,
}: {
  value: LotFieldsValue | undefined;
  onChange: (value: LotFieldsValue) => void;
  policy?: LotPolicy | null;
  disabled?: boolean;
  /** "Automatic" in an empty lot number (it is numbered when posted). */
  autoPlaceholder?: boolean;
}) {
  const { t, locale } = useI18n();
  const id = useId();
  const v = normalizeLot(value);
  const issues = lotIssues(v, policy);
  const set = (patch: Partial<LotFieldsValue>) => onChange({ ...v, ...patch });
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label={t("lots.fields.lotNo")} htmlFor={`${id}-no`} hint={autoPlaceholder ? t("lots.fields.lotNoHint") : undefined}>
        <input
          id={`${id}-no`}
          className="ds-input ds-mono"
          value={v.lotNo ?? ""}
          maxLength={LOT_NO_MAX}
          placeholder={autoPlaceholder ? t("lots.auto") : undefined}
          disabled={disabled}
          onChange={(e) => set({ lotNo: e.target.value || null })}
        />
      </Field>
      <Field
        label={t("lots.fields.supplierBatchNo")}
        htmlFor={`${id}-batch`}
        required={policy?.manualRequired}
        error={issues.includes("batchRequired") ? t("lots.issues.batchRequired") : null}
      >
        <input
          id={`${id}-batch`}
          className="ds-input ds-mono"
          value={v.supplierBatchNo ?? ""}
          maxLength={80}
          disabled={disabled}
          aria-invalid={issues.includes("batchRequired") || undefined}
          onChange={(e) => set({ supplierBatchNo: e.target.value || null })}
        />
      </Field>
      <Field label={t("lots.fields.mfgDate")} htmlFor={`${id}-mfg`}>
        <DateField id={`${id}-mfg`} value={v.mfgDate} onChange={(d) => set({ mfgDate: d })} locale={locale} labels={dateFieldLabels(t)} disabled={disabled} width="full" />
      </Field>
      <Field
        label={t("lots.fields.expDate")}
        htmlFor={`${id}-exp`}
        required={Boolean(policy?.manualRequired && policy.shelfLifeDays)}
        error={issues.includes("expRequired") ? t("lots.issues.expRequired") : issues.includes("datesInvalid") ? t("lots.issues.datesInvalid") : null}
      >
        <DateField
          id={`${id}-exp`}
          value={v.expDate}
          onChange={(d) => set({ expDate: d })}
          locale={locale}
          labels={dateFieldLabels(t)}
          disabled={disabled}
          invalid={issues.includes("expRequired") || issues.includes("datesInvalid")}
          width="full"
        />
      </Field>
    </div>
  );
}

/** A date cell of a line grid (the lot's production or expiry date). */
export function LotDateCell({ value, onChange, ctx }: { value: string | null; onChange: (value: string | null) => void; ctx: LineCellContext }) {
  const { t, locale } = useI18n();
  return (
    <DateField
      value={value}
      onChange={onChange}
      locale={locale}
      labels={dateFieldLabels(t)}
      disabled={!ctx.editable}
      invalid={ctx.invalid}
      aria-label={ctx.label}
      width="full"
    />
  );
}

/**
 * The lot columns of a line grid (lot number with an "Automatic" placeholder, supplier batch,
 * production and expiry date). `get` / `set` read and write the line's lot.
 */
export function lotLineColumns<L>({
  t,
  get,
  set,
  policyOf,
  optional = false,
}: {
  t: T;
  get: (line: L) => LotFieldsValue | undefined;
  set: (line: L, value: LotFieldsValue) => void;
  policyOf?: (line: L) => LotPolicy | null | undefined;
  /** Hidden until shown with the Columns button. */
  optional?: boolean;
}): LineColumn<L>[] {
  const v = (l: L) => normalizeLot(get(l));
  const patch = (l: L, p: Partial<LotFieldsValue>) => set(l, { ...v(l), ...p });
  const issues = (l: L) => lotIssues(v(l), policyOf?.(l));
  return [
    {
      key: "lotNo",
      header: t("lots.fields.lotNo"),
      hint: t("lots.fields.lotNoHint"),
      type: "text",
      width: 150,
      optional,
      cell: (l, ctx) => <LineTextCell ctx={ctx} mono maxLength={LOT_NO_MAX} placeholder={t("lots.auto")} value={v(l).lotNo} onChange={(x) => patch(l, { lotNo: x })} />,
    },
    {
      key: "supplierBatchNo",
      header: t("lots.fields.supplierBatchNo"),
      type: "text",
      width: 140,
      optional,
      error: (l) => (issues(l).includes("batchRequired") ? t("lots.issues.batchRequired") : null),
      cell: (l, ctx) => <LineTextCell ctx={ctx} mono maxLength={80} value={v(l).supplierBatchNo} onChange={(x) => patch(l, { supplierBatchNo: x })} />,
    },
    {
      key: "mfgDate",
      header: t("lots.fields.mfgDate"),
      type: "date",
      width: 140,
      optional: true,
      cell: (l, ctx) => <LotDateCell ctx={ctx} value={v(l).mfgDate} onChange={(x) => patch(l, { mfgDate: x })} />,
    },
    {
      key: "expDate",
      header: t("lots.fields.expDate"),
      type: "date",
      width: 140,
      optional,
      error: (l) => {
        const i = issues(l);
        return i.includes("expRequired") ? t("lots.issues.expRequired") : i.includes("datesInvalid") ? t("lots.issues.datesInvalid") : null;
      },
      cell: (l, ctx) => <LotDateCell ctx={ctx} value={v(l).expDate} onChange={(x) => patch(l, { expDate: x })} />,
    },
  ];
}

/**
 * The lots of one received quantity: one lot (its fields prefilled), or "Split into lots" with a
 * quantity per lot. The sum must equal the row; the issue shows live.
 */
export function LotSplitEditor({
  rows,
  total,
  unitLabel,
  sheetLengthM,
  onChange,
  name,
}: {
  rows: LotSplitRow[];
  total: number;
  unitLabel?: string | null;
  sheetLengthM?: number | null;
  onChange: (rows: LotSplitRow[]) => void;
  /** The product, for accessible names. */
  name: string;
}) {
  const { t, locale } = useI18n();
  const issue = lotSplitIssue(rows, total, sheetLengthM);
  const qty = lotQuantities(rows, total);
  const split = rows.length > 1;
  const set = (key: string, patch: Partial<LotSplitRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const shownQty = (q: number | null) => (q === null ? "" : String(sheetLengthM ? Math.round((q / sheetLengthM) * 1000) / 1000 : q));
  return (
    <div className="flex flex-col gap-2" data-lot-split="">
      {rows.map((r, i) => (
        <div key={r.key} className="flex flex-wrap items-end gap-2">
          {split ? (
            <label className="flex flex-col gap-1">
              <span className="text-[length:var(--ds-text-xs)] ds-muted">{t("lots.fields.qty")}</span>
              <input
                className="ds-input ds-mono w-24 tabular-nums"
                type="number"
                min={0}
                step={sheetLengthM ? 1 : "any"}
                inputMode="decimal"
                aria-label={t("lots.split.qtyOf", { name, n: i + 1 })}
                value={shownQty(r.qty)}
                onChange={(e) => {
                  if (e.target.value === "") return set(r.key, { qty: null });
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n >= 0) set(r.key, { qty: sheetLengthM ? Math.round(n * sheetLengthM * 1000) / 1000 : n });
                }}
              />
            </label>
          ) : (
            <span className="text-[length:var(--ds-text-xs)] ds-muted tabular-nums self-center">
              {t("lots.split.whole", { qty: qty[0], unit: unitLabel ?? "" })}
            </span>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-[length:var(--ds-text-xs)] ds-muted">{t("lots.fields.lotNo")}</span>
            <input
              className="ds-input ds-mono w-40"
              maxLength={LOT_NO_MAX}
              placeholder={t("lots.auto")}
              aria-label={t("lots.split.fieldOf", { field: t("lots.fields.lotNo"), name, n: i + 1 })}
              value={r.lotNo ?? ""}
              onChange={(e) => set(r.key, { lotNo: e.target.value || null })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[length:var(--ds-text-xs)] ds-muted">{t("lots.fields.supplierBatchNo")}</span>
            <input
              className="ds-input ds-mono w-36"
              maxLength={80}
              aria-label={t("lots.split.fieldOf", { field: t("lots.fields.supplierBatchNo"), name, n: i + 1 })}
              value={r.supplierBatchNo ?? ""}
              onChange={(e) => set(r.key, { supplierBatchNo: e.target.value || null })}
            />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-[length:var(--ds-text-xs)] ds-muted">{t("lots.fields.mfgDate")}</span>
            <DateField
              value={r.mfgDate}
              onChange={(d) => set(r.key, { mfgDate: d })}
              locale={locale}
              labels={dateFieldLabels(t)}
              aria-label={t("lots.split.fieldOf", { field: t("lots.fields.mfgDate"), name, n: i + 1 })}
              width="sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[length:var(--ds-text-xs)] ds-muted">{t("lots.fields.expDate")}</span>
            <DateField
              value={r.expDate}
              onChange={(d) => set(r.key, { expDate: d })}
              locale={locale}
              labels={dateFieldLabels(t)}
              aria-label={t("lots.split.fieldOf", { field: t("lots.fields.expDate"), name, n: i + 1 })}
              width="sm"
            />
          </div>
          {split ? (
            <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" aria-label={t("lots.split.remove", { name, n: i + 1 })} onClick={() => onChange(removeLot(rows, r.key))}>
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="ds-btn ds-btn-sm" onClick={() => onChange(addLot(rows, total))} data-lot-split-add="">
          {split ? <Plus className="h-4 w-4" aria-hidden /> : <Split className="h-4 w-4" aria-hidden />}
          {split ? t("lots.split.add") : t("lots.split.action")}
        </button>
        {issue ? (
          <span role="alert" className="text-[length:var(--ds-text-xs)]" style={{ color: "var(--ds-danger, #e11d48)" }}>
            {t(`lots.split.issues.${issue}`, { total, sum: qty.reduce((s, q) => s + q, 0) })}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** A received lot as a chip; a link to the lot card when `linkable` (LOT_TRACKING on). */
export function LotChip({ lotId, lotNo, linkable }: { lotId: string; lotNo: string | null; linkable: boolean }) {
  const { t } = useI18n();
  const text = lotNo ?? t("lots.chipUnknown");
  const content = (
    <span className="ds-chip ds-chip-flat ds-mono" data-lot-chip="">
      {t("lots.chip", { lot: text })}
    </span>
  );
  return linkable ? (
    <Link href={lotHref(lotId)} className="underline-offset-2 hover:underline" aria-label={t("lots.openLot", { lot: text })}>
      {content}
    </Link>
  ) : (
    content
  );
}

export interface LotLabelData {
  lotNo: string;
  productName: string;
  productCode: string | null;
  supplierBatchNo: string | null;
  expDate: string | null;
  receiptNo: string | null;
  /** For a Polywood sheet: its length. */
  lengthM?: number | null;
}

/** Lot labels to print (one per lot, or one per sheet for Polywood): the lot number as Code128 and QR. */
export function LotLabelsSheet({ labels }: { labels: LotLabelData[] }) {
  const { t, formatDate } = useI18n();
  return (
    <div className="lot-labels" data-lot-labels="">
      {labels.map((l, i) => (
        <section
          key={`${l.lotNo}-${i}`}
          style={{ breakInside: "avoid", pageBreakInside: "avoid", border: "1px solid #000", padding: "4mm", margin: "2mm", width: "90mm", display: "inline-block", verticalAlign: "top", fontSize: "9pt", color: "#000", background: "#fff" }}
        >
          <div style={{ display: "flex", gap: "3mm", alignItems: "center" }}>
            <QrCodeImage value={l.lotNo} size={72} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: "11pt" }}>{l.lotNo}</div>
              <div>{[l.productCode, l.productName].filter(Boolean).join(" · ")}</div>
              {l.supplierBatchNo ? <div>{t("lots.fields.supplierBatchNo")}: {l.supplierBatchNo}</div> : null}
              {l.expDate ? <div>{t("lots.fields.expDate")}: {formatDate(l.expDate)}</div> : null}
              {l.receiptNo ? <div>{t("lots.labels.receipt")}: {l.receiptNo}</div> : null}
              {l.lengthM ? <div>{t("lots.labels.length", { m: l.lengthM })}</div> : null}
            </div>
          </div>
          <BarcodeDisplay value={l.lotNo} format="CODE128" height={34} width={1.3} />
        </section>
      ))}
    </div>
  );
}
