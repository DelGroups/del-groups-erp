/**
 * LOT-3: choosing the lots an outbound line takes (pure, so `node --test` covers it).
 * The LotPicker (../components/LotPicker.tsx) shows a product's lots in the line's warehouse,
 * suggests FEFO and lets the user split the line over several lots. Nothing chosen = automatic:
 * no "lots" key is sent and the database picks FEFO, then FIFO (20261115120000_lot_outbound.sql).
 * The database checks the same rules again (_lot_check_choice) before any stock moves.
 */

export type LotStatus = "active" | "quarantine" | "closed";

/** One lot of a product with its balance in one warehouse. */
export interface LotOption {
  id: string;
  lotNo: string;
  supplierBatchNo: string | null;
  /** yyyy-mm-dd */
  expDate: string | null;
  /** yyyy-mm-dd */
  receivedDate: string | null;
  status: LotStatus;
  /** Balance in the line's warehouse (stock unit). */
  qty: number;
}

/** One chosen lot of a line: [{lotId, qty}] (stock unit). */
export interface LotChoice {
  lotId: string;
  qty: number;
}

export type LotExpiry = "expired" | "near" | "ok" | "none";

export type LotChoiceIssue = "sumMismatch" | "emptyQty" | "short" | "blocked" | "expired" | "unknown" | "duplicate";

/** Days before the expiry date a lot shows the "near expiry" badge. */
export const NEAR_EXPIRY_DAYS = 30;

const EPS = 0.0005;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function dayNumber(iso: string): number {
  const d = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Math.floor(d / 86_400_000);
}

/** Expired (before today), near (within `nearDays`), ok, or none (no expiry date). */
export function lotExpiry(expDate: string | null | undefined, today: string, nearDays = NEAR_EXPIRY_DAYS): LotExpiry {
  if (!expDate || !/^\d{4}-\d{2}-\d{2}/.test(expDate)) return "none";
  const left = dayNumber(expDate) - dayNumber(today);
  if (left < 0) return "expired";
  return left <= nearDays ? "near" : "ok";
}

/** The order FEFO uses: expiry date, then receipt date, then lot number (no date last). */
export function fefoCompare(a: LotOption, b: LotOption): number {
  const cmp = (x: string | null, y: string | null) => (x === y ? 0 : x === null ? 1 : y === null ? -1 : x < y ? -1 : 1);
  return cmp(a.expDate, b.expDate) || cmp(a.receivedDate, b.receivedDate) || (a.lotNo < b.lotNo ? -1 : a.lotNo > b.lotNo ? 1 : 0);
}

/** Lots with stock in FEFO order; the ones FEFO may pick (active) first, quarantine / closed last. */
export function sortLotsFefo(options: readonly LotOption[]): LotOption[] {
  return options
    .filter((o) => o.qty > EPS)
    .slice()
    .sort((a, b) => Number(a.status !== "active") - Number(b.status !== "active") || fefoCompare(a, b));
}

/**
 * What automatic picking takes for `qty` (the same rule as the database: active lots only, FEFO);
 * `short` is what no lot covers.
 */
export function suggestFefo(options: readonly LotOption[], qty: number): { choice: LotChoice[]; short: number } {
  let left = r3(Math.max(0, qty));
  const choice: LotChoice[] = [];
  for (const o of sortLotsFefo(options)) {
    if (left <= EPS) break;
    if (o.status !== "active") continue;
    const take = r3(Math.min(left, o.qty));
    if (take <= EPS) continue;
    choice.push({ lotId: o.id, qty: take });
    left = r3(left - take);
  }
  return { choice, short: left > EPS ? left : 0 };
}

/** The first issue of a choice for a line of `qty` (null = fine). Expired lots need lots.manage. */
export function lotChoiceIssue(
  choice: readonly LotChoice[] | null | undefined,
  qty: number,
  options: readonly LotOption[],
  { today, canManage }: { today: string; canManage: boolean },
): LotChoiceIssue | null {
  if (!choice || choice.length === 0) return null;
  const byId = new Map(options.map((o) => [o.id, o]));
  const used = new Map<string, number>();
  for (const c of choice) {
    const lot = byId.get(c.lotId);
    if (!lot) return "unknown";
    if (lot.status !== "active") return "blocked";
    if (!canManage && lotExpiry(lot.expDate, today) === "expired") return "expired";
    if (!(c.qty > 0)) return "emptyQty";
    if (used.has(c.lotId)) return "duplicate";
    used.set(c.lotId, c.qty);
    if (c.qty > lot.qty + EPS) return "short";
  }
  const sum = choice.reduce((s, c) => s + c.qty, 0);
  return Math.abs(sum - qty) > EPS ? "sumMismatch" : null;
}

/** One lot for the whole line. */
export function chooseSingle(lotId: string, qty: number): LotChoice[] {
  return [{ lotId, qty: r3(qty) }];
}

/** The line's quantity changed: a single chosen lot follows it; a split stays as typed. */
export function followQuantity(choice: readonly LotChoice[] | null | undefined, qty: number): LotChoice[] | null {
  if (!choice || choice.length === 0) return null;
  return choice.length === 1 ? [{ ...choice[0], qty: r3(qty) }] : [...choice];
}

/** Another row in the split: the next FEFO lot not yet used, with what is still missing. */
export function addSplitRow(choice: readonly LotChoice[], qty: number, options: readonly LotOption[]): LotChoice[] {
  const used = new Set(choice.map((c) => c.lotId));
  const sum = choice.reduce((s, c) => s + c.qty, 0);
  const next = sortLotsFefo(options).find((o) => o.status === "active" && !used.has(o.id));
  if (!next) return [...choice];
  const missing = r3(Math.max(0, qty - sum));
  return [...choice, { lotId: next.id, qty: r3(Math.min(missing || next.qty, next.qty)) }];
}

/** The payload key of a line: [{lot_id, qty}] when lots are chosen, undefined for automatic. */
export function lotsPayload(choice: readonly LotChoice[] | null | undefined): { lot_id: string; qty: number }[] | undefined {
  if (!choice || choice.length === 0) return undefined;
  return choice.map((c) => ({ lot_id: c.lotId, qty: r3(c.qty) }));
}

/** A line's stored lots ([{lot_id, qty}] JSON) back to a choice; null for automatic. */
export function choiceFromPayload(raw: unknown): LotChoice[] | null {
  if (!Array.isArray(raw)) return null;
  const out = raw
    .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : null))
    .filter((x): x is Record<string, unknown> => !!x && typeof x.lot_id === "string")
    .map((x) => ({ lotId: x.lot_id as string, qty: r3(Number(x.qty) || 0) }));
  return out.length ? out : null;
}

/** The chosen lots of a line as a short text ("LOT-1 ×3 · LOT-2 ×1"), or null for automatic. */
export function choiceSummary(choice: readonly LotChoice[] | null | undefined, options: readonly LotOption[], formatQty: (n: number) => string = String): string | null {
  if (!choice || choice.length === 0) return null;
  const byId = new Map(options.map((o) => [o.id, o]));
  if (choice.length === 1) return byId.get(choice[0].lotId)?.lotNo ?? null;
  return choice.map((c) => `${byId.get(c.lotId)?.lotNo ?? "?"} ×${formatQty(c.qty)}`).join(" · ");
}

/** The lot_choice_* code of a database error ("lot_choice_short: ..."), or null. */
export function lotChoiceErrorCode(message: string | null | undefined): "invalid" | "blocked" | "expired" | "short" | "sum" | null {
  const m = /lot_choice_(invalid|blocked|expired|short|sum)\b/.exec(message ?? "");
  return m ? (m[1] as "invalid" | "blocked" | "expired" | "short" | "sum") : null;
}

/** A row of the lots a posted document took (stock_lot_movements), for the read-only chips. */
export interface DocumentLotRow {
  lineId: string | null;
  productId: string;
  lotId: string;
  lotNo: string;
  qty: number;
}

/** The lots of one line (or one product when lines are not recorded), merged by lot. */
export function lotsOfLine(rows: readonly DocumentLotRow[], { lineId, productId }: { lineId?: string | null; productId?: string | null }): DocumentLotRow[] {
  const hasLine = lineId ? rows.some((r) => r.lineId === lineId) : false;
  const picked = rows.filter((r) => (hasLine ? r.lineId === lineId : productId ? r.productId === productId : false));
  const merged = new Map<string, DocumentLotRow>();
  for (const r of picked) {
    const prev = merged.get(r.lotId);
    merged.set(r.lotId, prev ? { ...prev, qty: r3(prev.qty + r.qty) } : { ...r });
  }
  return [...merged.values()].filter((r) => r.qty > EPS).sort((a, b) => (a.lotNo < b.lotNo ? -1 : a.lotNo > b.lotNo ? 1 : 0));
}
