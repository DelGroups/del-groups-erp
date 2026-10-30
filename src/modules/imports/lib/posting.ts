/**
 * IMP-2 pure logic: what is left to receive, the Receive dialog's rows and checks, the receiving
 * sheets (one page per warehouse), payment splits, the new cost's split for the database and the
 * database's error codes. No database access: the dialogs and the tests use the same functions.
 */
import type { ImportsConfig } from "@/lib/imports/config";
import { round2, toCents } from "@/lib/imports/landedCost";
import { landedCostOf, newRowKey, type CostLineDraft, type ImportProduct, type ShipmentDraft, type ShipmentStatus } from "./shipment";

const EPS = 0.0005;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

// ── Status and actions ──────────────────────────────────────────────────────

export type PostingAction = "confirm" | "receive" | "addCost" | "pay" | "close" | "reopen" | "cancel";

/** Which buttons a shipment in this status shows (permissions are checked separately). */
export function actionsFor(status: ShipmentStatus): PostingAction[] {
  switch (status) {
    case "draft":
      return ["confirm", "cancel"];
    case "confirmed":
    case "cleared":
      return ["receive", "addCost", "pay", "cancel"];
    case "partially_received":
      return ["receive", "addCost", "pay", "cancel"];
    case "received":
      return ["addCost", "pay", "close", "cancel"];
    case "closed":
      return ["reopen"];
    default:
      return [];
  }
}

// ── Receiving ───────────────────────────────────────────────────────────────

export interface ReceivedSoFar {
  shipmentLineId: string;
  qtyStockUnit: number;
}

export interface ReceiveLine {
  shipmentLineId: string;
  productId: string;
  /** Ordered, in the stock unit (metres for sheet products). */
  orderedStock: number;
  received: number;
  remaining: number;
  /** Metres per sheet for sheet products, else null (stock unit = purchase unit). */
  sheetLengthM: number | null;
  purchaseUnit: string | null;
  defaultWarehouseId: string | null;
}

/** Every product line with what is still to receive. */
export function receiveLines(draft: ShipmentDraft, products: ReadonlyMap<string, ImportProduct>, received: readonly ReceivedSoFar[]): ReceiveLine[] {
  return draft.lines.map((l) => {
    const got = received.filter((r) => r.shipmentLineId === l.key).reduce((s, r) => s + r.qtyStockUnit, 0);
    const product = products.get(l.productId);
    return {
      shipmentLineId: l.key,
      productId: l.productId,
      orderedStock: l.qtyStock,
      received: r3(got),
      remaining: Math.max(0, r3(l.qtyStock - got)),
      sheetLengthM: product?.sheetLengthM ?? null,
      purchaseUnit: l.purchaseUnit,
      defaultWarehouseId: l.warehouseId ?? draft.defaultWarehouseId,
    };
  });
}

/** A row of the Receive dialog: one line into one warehouse; a line may have several rows. */
export interface ReceiveRow {
  key: string;
  shipmentLineId: string;
  warehouseId: string | null;
  /** What the sheet says is coming (stock unit). */
  expected: number;
  /** What the keeper counted (stock unit); null until entered. */
  actual: number | null;
}

/** One row per line with something left, everything expected into its warehouse. */
export function initialReceiveRows(lines: readonly ReceiveLine[]): ReceiveRow[] {
  return lines.filter((l) => l.remaining > EPS).map((l) => ({ key: newRowKey("l"), shipmentLineId: l.shipmentLineId, warehouseId: l.defaultWarehouseId, expected: l.remaining, actual: null }));
}

/** Splits a row: the new row takes half of what is expected (whole sheets for sheet products). */
export function splitReceiveRow(rows: readonly ReceiveRow[], key: string, line: ReceiveLine): ReceiveRow[] {
  const row = rows.find((r) => r.key === key);
  if (!row) return [...rows];
  const unit = line.sheetLengthM ?? 0;
  let half = row.expected / 2;
  if (unit > 0) half = Math.floor(row.expected / unit / 2) * unit;
  else half = r3(half);
  const next: ReceiveRow = { key: newRowKey("l"), shipmentLineId: row.shipmentLineId, warehouseId: null, expected: r3(row.expected - half), actual: null };
  return rows.flatMap((r) => (r.key === key ? [{ ...r, expected: half }, next] : [r]));
}

/** Sheets for a quantity in metres (sheet products), else null. */
export function sheetsOf(qtyStock: number, sheetLengthM: number | null): number | null {
  return sheetLengthM && sheetLengthM > 0 ? r3(qtyStock / sheetLengthM) : null;
}

export type ReceiveIssue = "nothing" | "warehouse" | "whole_sheets" | "over" | "negative";

export interface ReceiveCheck {
  issues: { code: ReceiveIssue; shipmentLineId?: string; rowKey?: string }[];
  /** Counted − expected per row where they differ (shown before posting). */
  differences: { rowKey: string; shipmentLineId: string; expected: number; actual: number; difference: number }[];
  /** The RPC payload. */
  payload: { shipment_line_id: string; warehouse_id: string; qty_stock_unit: number; expected_qty_stock_unit: number }[];
}

/** Checks the counted quantities and builds what receive_import_shipment gets. */
export function checkReceipt(rows: readonly ReceiveRow[], lines: readonly ReceiveLine[]): ReceiveCheck {
  const issues: ReceiveCheck["issues"] = [];
  const differences: ReceiveCheck["differences"] = [];
  const payload: ReceiveCheck["payload"] = [];
  const byLine = new Map(lines.map((l) => [l.shipmentLineId, l]));
  const perLine = new Map<string, number>();
  for (const row of rows) {
    const qty = row.actual ?? row.expected;
    const line = byLine.get(row.shipmentLineId);
    if (!line) continue;
    if (qty < 0) {
      issues.push({ code: "negative", rowKey: row.key });
      continue;
    }
    if (row.actual !== null && Math.abs(row.actual - row.expected) > EPS) {
      differences.push({ rowKey: row.key, shipmentLineId: row.shipmentLineId, expected: row.expected, actual: row.actual, difference: r3(row.actual - row.expected) });
    }
    if (qty <= EPS) continue;
    if (!row.warehouseId) issues.push({ code: "warehouse", rowKey: row.key });
    if (line.sheetLengthM) {
      const sheets = qty / line.sheetLengthM;
      if (Math.abs(sheets - Math.round(sheets)) > 0.001) issues.push({ code: "whole_sheets", rowKey: row.key, shipmentLineId: row.shipmentLineId });
    }
    perLine.set(row.shipmentLineId, (perLine.get(row.shipmentLineId) ?? 0) + qty);
    if (row.warehouseId) payload.push({ shipment_line_id: row.shipmentLineId, warehouse_id: row.warehouseId, qty_stock_unit: r3(qty), expected_qty_stock_unit: r3(row.expected) });
  }
  for (const [lineId, qty] of perLine) {
    const line = byLine.get(lineId);
    if (line && qty > line.remaining + EPS) issues.push({ code: "over", shipmentLineId: lineId });
  }
  if (payload.length === 0 && !issues.length) issues.push({ code: "nothing" });
  return { issues, differences, payload };
}

// ── Receiving sheet (print) ─────────────────────────────────────────────────

export interface SheetRow {
  no: number;
  productId: string;
  code: string;
  name: string;
  barcode: string | null;
  /** In the purchase unit (sheets, rolls) when it can be derived, else null. */
  qtyPurchase: number | null;
  purchaseUnit: string | null;
  qtyStock: number;
  stockUnit: "m" | null;
}

export interface SheetPage {
  warehouseId: string;
  rows: SheetRow[];
}

/** One page per destination warehouse; no prices or costs. */
export function receivingSheetPages(
  rows: readonly { shipmentLineId: string; warehouseId: string | null; qtyStock: number }[],
  draft: ShipmentDraft,
  products: ReadonlyMap<string, ImportProduct & { barcode?: string | null }>
): SheetPage[] {
  const pages = new Map<string, SheetRow[]>();
  for (const row of rows) {
    if (!row.warehouseId || row.qtyStock <= EPS) continue;
    const line = draft.lines.find((l) => l.key === row.shipmentLineId);
    if (!line) continue;
    const product = products.get(line.productId);
    const sheet = product?.sheetLengthM ?? null;
    const perPurchase = sheet ?? (line.qtyPurchase > 0 && line.qtyStock > 0 ? line.qtyStock / line.qtyPurchase : null);
    const list = pages.get(row.warehouseId) ?? [];
    list.push({
      no: list.length + 1,
      productId: line.productId,
      code: product?.code ?? "",
      name: product?.name ?? "",
      barcode: product?.barcode ?? null,
      qtyPurchase: perPurchase ? r3(row.qtyStock / perPurchase) : null,
      purchaseUnit: line.purchaseUnit,
      qtyStock: r3(row.qtyStock),
      stockUnit: sheet ? "m" : null,
    });
    pages.set(row.warehouseId, list);
  }
  return [...pages.entries()].map(([warehouseId, list]) => ({ warehouseId, rows: list }));
}

// ── Payments ────────────────────────────────────────────────────────────────

export interface PaySplit {
  key: string;
  accountId: string | null;
  amount: number | null;
}

export interface PayTotals {
  thisPayment: number;
  remainingAfter: number;
  overpay: boolean;
  /** Every row has an account and a positive amount, and at least one row exists. */
  complete: boolean;
  duplicateAccount: boolean;
}

export function payTotals(open: number, splits: readonly PaySplit[]): PayTotals {
  const cents = splits.reduce((s, x) => s + toCents(x.amount ?? 0), 0);
  const openCents = toCents(open);
  const accounts = splits.map((s) => s.accountId).filter(Boolean);
  return {
    thisPayment: cents / 100,
    remainingAfter: (openCents - cents) / 100,
    overpay: cents > openCents,
    complete: splits.length > 0 && splits.every((s) => !!s.accountId && (s.amount ?? 0) > 0),
    duplicateAccount: new Set(accounts).size !== accounts.length,
  };
}

/** The RPC's splits. */
export function paySplitsPayload(splits: readonly PaySplit[]): { account_id: string; amount: number }[] {
  return splits.filter((s) => s.accountId && (s.amount ?? 0) > 0).map((s) => ({ account_id: s.accountId as string, amount: round2(s.amount as number) }));
}

// ── A cost added or settled after confirmation ──────────────────────────────

/** The cost computed with every other cost of the shipment (its AZN amount and split). */
function computedCost(draft: ShipmentDraft, config: ImportsConfig, cost: CostLineDraft) {
  const withCost = { ...draft, costs: [...draft.costs.filter((c) => c.key !== cost.key), cost] };
  return landedCostOf(withCost, config).costs.find((c) => c.id === cost.key) ?? null;
}

/** The split of one cost over the stored lines, computed with every other cost of the shipment. */
export function allocationsFor(draft: ShipmentDraft, config: ImportsConfig, cost: CostLineDraft): { shipment_line_id: string; amount_azn: number }[] {
  const computed = computedCost(draft, config, cost);
  if (!computed) return [];
  return Object.entries(computed.allocations).map(([lineKey, amount]) => ({ shipment_line_id: lineKey, amount_azn: amount }));
}

/** The cost as add_import_cost / finalize_import_cost read it (amount in its currency; a duty split per line in AZN). */
export function costPayload(draft: ShipmentDraft, config: ImportsConfig, cost: CostLineDraft) {
  const duty = cost.splitMethod === "per_line_duty";
  return {
    cost_type: cost.costType,
    partner_id: cost.partnerId,
    description: cost.description,
    amount: duty ? computedCost(draft, config, cost)?.amountAzn ?? 0 : cost.amount,
    currency_code: duty ? "AZN" : cost.currencyCode,
    rate_to_azn: cost.currencyCode === "AZN" || duty ? 1 : cost.rateToAzn,
    vat_amount_azn: cost.vatAmountAzn,
    is_capitalized: cost.costType === "customs_vat" ? false : cost.isCapitalized,
    split_method: cost.splitMethod,
    is_estimate: cost.isEstimate,
    allocations: allocationsFor(draft, config, cost),
  };
}

/** Cost + VAT in AZN, what is paid at once or owed. */
export function costTotalAzn(cost: Pick<CostLineDraft, "amount" | "currencyCode" | "rateToAzn" | "vatAmountAzn">): number {
  const rate = cost.currencyCode === "AZN" ? 1 : cost.rateToAzn;
  return round2(round2(cost.amount * rate) + cost.vatAmountAzn);
}

// ── Database errors ─────────────────────────────────────────────────────────

/** The posting functions raise "imports_<code>: <text>"; the text is Azerbaijani detail. */
export function parsePostingError(message: string | null | undefined): { code: string | null; detail: string } {
  const text = String(message ?? "");
  const m = /imports_([a-z_]+):\s*([\s\S]*)$/.exec(text);
  if (m) return { code: m[1], detail: m[2].trim() };
  if (/bağlı maliyyə dövrünə/.test(text)) return { code: "period_closed", detail: text };
  if (/balansı kifayət etmir/.test(text)) return { code: "insufficient_balance", detail: text };
  return { code: null, detail: text };
}

export const POSTING_ERROR_CODES = [
  "forbidden",
  "not_found",
  "not_draft",
  "supplier_required",
  "no_lines",
  "allocation_stale",
  "allocation_mismatch",
  "cost_partner_required",
  "cannot_receive",
  "receipt_empty",
  "line_not_found",
  "over_receipt",
  "whole_sheets",
  "warehouse_required",
  "date_before_confirm",
  "closed",
  "cannot_post",
  "not_estimate",
  "below_paid",
  "refund_not_supported",
  "splits_mismatch",
  "cannot_pay",
  "payment_before_document",
  "splits_required",
  "invalid_split",
  "overpay",
  "insufficient_balance",
  "account_not_found",
  "cannot_close",
  "estimates_open",
  "transit_not_zero",
  "not_closed",
  "reason_required",
  "cannot_cancel",
  "stock_consumed",
  "period_closed",
  "invalid_amount",
] as const;

/** A new pay split row. */
export function newSplit(accountId: string | null = null, amount: number | null = null): PaySplit {
  return { key: newRowKey("c"), accountId, amount };
}
