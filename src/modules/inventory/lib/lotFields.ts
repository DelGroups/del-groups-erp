/**
 * LOT-2: the lot fields of an inbound document line (pure, so `node --test` covers it).
 * One shape for imports, purchases and the initial balance; the components in
 * ../components/LotFields.tsx edit it, and the payload helpers turn it into the keys the database
 * functions read (20261115110000_lot_inbound.sql). An empty value sends no keys at all, so a
 * document saved with lot tracking off is saved exactly as before.
 */

export interface LotFieldsValue {
  /** Our lot number; empty = automatic (LOT-YYYY-NNNNN). */
  lotNo: string | null;
  /** The manufacturer's / supplier's batch number printed on the goods. */
  supplierBatchNo: string | null;
  /** yyyy-mm-dd */
  mfgDate: string | null;
  /** yyyy-mm-dd */
  expDate: string | null;
}

/** What a product asks of its lots (products.lot_policy, products.shelf_life_days). */
export interface LotPolicy {
  manualRequired: boolean;
  shelfLifeDays: number | null;
}

export type LotIssue = "batchRequired" | "expRequired" | "datesInvalid" | "lotNoTooLong";

export const LOT_NO_MAX = 60;

export const EMPTY_LOT: LotFieldsValue = Object.freeze({ lotNo: null, supplierBatchNo: null, mfgDate: null, expDate: null });

const clean = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
};
const isoDate = (v: unknown): string | null => {
  const t = clean(v);
  return t && /^\d{4}-\d{2}-\d{2}$/.test(t.slice(0, 10)) ? t.slice(0, 10) : null;
};

/** Trimmed, empty strings as null, dates as yyyy-mm-dd. */
export function normalizeLot(v: Partial<LotFieldsValue> | null | undefined): LotFieldsValue {
  return {
    lotNo: clean(v?.lotNo),
    supplierBatchNo: clean(v?.supplierBatchNo),
    mfgDate: isoDate(v?.mfgDate),
    expDate: isoDate(v?.expDate),
  };
}

export function isEmptyLot(v: Partial<LotFieldsValue> | null | undefined): boolean {
  const n = normalizeLot(v);
  return !n.lotNo && !n.supplierBatchNo && !n.mfgDate && !n.expDate;
}

/** mfg + shelf life (yyyy-mm-dd), or null. */
export function defaultExpiry(mfgDate: string | null, shelfLifeDays: number | null): string | null {
  if (!mfgDate || !shelfLifeDays || shelfLifeDays <= 0) return null;
  const d = new Date(`${mfgDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + shelfLifeDays);
  return d.toISOString().slice(0, 10);
}

/** The issues of a lot (the database checks the same; these show them before saving). */
export function lotIssues(v: Partial<LotFieldsValue> | null | undefined, policy?: LotPolicy | null): LotIssue[] {
  const n = normalizeLot(v);
  const issues: LotIssue[] = [];
  const exp = n.expDate ?? defaultExpiry(n.mfgDate, policy?.shelfLifeDays ?? null);
  if (policy?.manualRequired) {
    if (!n.supplierBatchNo) issues.push("batchRequired");
    if (policy.shelfLifeDays && !exp) issues.push("expRequired");
  }
  if (n.mfgDate && n.expDate && n.expDate < n.mfgDate) issues.push("datesInvalid");
  if (n.lotNo && n.lotNo.length > LOT_NO_MAX) issues.push("lotNoTooLong");
  return issues;
}

/**
 * The keys a document line sends: "line" (purchases, initial balance: lot_no, supplier_batch_no,
 * mfg_date, exp_date) or "planned" (import lines: lot_no_planned, ...). Only non-empty values.
 */
export function lotPayloadKeys(v: Partial<LotFieldsValue> | null | undefined, kind: "line" | "planned" = "line"): Record<string, string> {
  const n = normalizeLot(v);
  const out: Record<string, string> = {};
  if (n.lotNo) out[kind === "planned" ? "lot_no_planned" : "lot_no"] = n.lotNo;
  if (n.supplierBatchNo) out.supplier_batch_no = n.supplierBatchNo;
  if (n.mfgDate) out.mfg_date = n.mfgDate;
  if (n.expDate) out.exp_date = n.expDate;
  return out;
}

/** The lot fields of a stored row (lot_no or lot_no_planned, supplier_batch_no, mfg_date, exp_date); undefined when empty. */
export function lotFromRow(row: Record<string, unknown> | null | undefined): LotFieldsValue | undefined {
  if (!row) return undefined;
  const v = normalizeLot({
    lotNo: (row.lot_no ?? row.lot_no_planned) as string | null,
    supplierBatchNo: row.supplier_batch_no as string | null,
    mfgDate: row.mfg_date as string | null,
    expDate: row.exp_date as string | null,
  });
  return isEmptyLot(v) ? undefined : v;
}

// ── Splitting one received quantity into lots ───────────────────────────────

export interface LotSplitRow extends LotFieldsValue {
  key: string;
  /** Quantity of this lot (stock unit); null on a single lot = the whole row. */
  qty: number | null;
}

export type LotSplitIssue = "sumMismatch" | "emptyQty" | "duplicateLotNo" | "wholeSheets";

const r3 = (n: number) => Math.round(n * 1000) / 1000;
let splitSeq = 0;
const splitKey = () => `lot-${Date.now().toString(36)}-${(splitSeq++).toString(36)}`;

/** One lot for the whole row, prefilled (e.g. from an import line's plan). */
export function singleLot(prefill?: Partial<LotFieldsValue> | null): LotSplitRow[] {
  return [{ key: splitKey(), qty: null, ...normalizeLot(prefill) }];
}

/** The quantity each lot gets: a single lot takes the whole row. */
export function lotQuantities(rows: readonly LotSplitRow[], total: number): number[] {
  if (rows.length === 1) return [r3(total)];
  return rows.map((r) => r3(r.qty ?? 0));
}

/**
 * Another lot under the row: the first lot keeps its quantity (the whole row when it was single),
 * the new one gets what is left (0 when nothing is).
 */
export function addLot(rows: readonly LotSplitRow[], total: number): LotSplitRow[] {
  const current = rows.length === 1 ? [{ ...rows[0], qty: r3(total) }] : [...rows];
  const used = current.reduce((s, r) => s + (r.qty ?? 0), 0);
  return [...current, { key: splitKey(), qty: Math.max(0, r3(total - used)), lotNo: null, supplierBatchNo: null, mfgDate: null, expDate: null }];
}

/** Without a lot; one left = back to a single lot for the whole row. */
export function removeLot(rows: readonly LotSplitRow[], key: string): LotSplitRow[] {
  const next = rows.filter((r) => r.key !== key);
  if (next.length === 0) return singleLot();
  return next.length === 1 ? [{ ...next[0], qty: null }] : next;
}

/** Live check: the lots add up to the row; sheet products split in whole sheets; one number once. */
export function lotSplitIssue(rows: readonly LotSplitRow[], total: number, sheetLengthM?: number | null): LotSplitIssue | null {
  if (rows.length > 1) {
    if (rows.some((r) => r.qty === null || r.qty <= 0)) return "emptyQty";
    if (Math.abs(rows.reduce((s, r) => s + (r.qty ?? 0), 0) - total) > 0.0005) return "sumMismatch";
  }
  if (sheetLengthM && sheetLengthM > 0) {
    for (const q of lotQuantities(rows, total)) {
      const sheets = q / sheetLengthM;
      if (Math.abs(sheets - Math.round(sheets)) > 0.001) return "wholeSheets";
    }
  }
  const numbers = rows.map((r) => normalizeLot(r).lotNo).filter((n): n is string => !!n);
  if (new Set(numbers).size !== numbers.length) return "duplicateLotNo";
  return null;
}

/** receive_import_shipment's `lots` for one row: [{qty_stock_unit, lot_no?, supplier_batch_no?, mfg_date?, exp_date?}]. */
export function receiptLotsPayload(rows: readonly LotSplitRow[], total: number): Record<string, string | number>[] {
  const qty = lotQuantities(rows, total);
  return rows.map((r, i) => ({ qty_stock_unit: qty[i], ...lotPayloadKeys(r) }));
}

/** A short text for a lot ("LOT-2026-00012 · SB-7 · 01.03.2027"), or null when it says nothing. */
export function lotSummary(v: Partial<LotFieldsValue> | null | undefined, formatDate: (iso: string) => string = (d) => d): string | null {
  const n = normalizeLot(v);
  const parts = [n.lotNo, n.supplierBatchNo, n.expDate ? formatDate(n.expDate) : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** The lot card route (the page comes in LOT-4). */
export function lotHref(lotId: string): string {
  return `/inventory/lots/${encodeURIComponent(lotId)}`;
}
