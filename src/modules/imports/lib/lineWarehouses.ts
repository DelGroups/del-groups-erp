/**
 * Warehouse of each import line, and one line split over several warehouses (IMP-4, Del
 * 2026-11-04). Pure: the form, the server action, the receive dialog and the prints use the same
 * functions, and tests cover them.
 *
 * A line goes into one warehouse (its own, else the shipment's default), or, with a split, into
 * several: rows warehouse × quantity in the purchase unit (whole sheets for sheet products) that
 * add up to the line. Any number of warehouses (other tenants use more than Del's two).
 */
import type { ShipmentLineDraft } from "./shipment";

/** One row of a line's split. */
export interface LineWarehouseSplit {
  key: string;
  warehouseId: string | null;
  /** In the purchase unit (sheets, pieces). */
  qtyPurchase: number;
}

/** A warehouse a line goes into, with its quantity in both units. */
export interface LineWarehouseShare {
  warehouseId: string | null;
  qtyPurchase: number;
  /** Stock unit: metres for sheet products. */
  qtyStock: number;
  /** "split": a planned split row; "line": the line's own warehouse; "header": the shipment's default. */
  source: "split" | "line" | "header";
}

const EPS = 0.0005;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

let seq = 0;
export function newSplitKey(): string {
  seq += 1;
  return `new-w-${Date.now().toString(36)}-${seq}`;
}

/**
 * Stock quantity of each split row: sheets × sheet length for sheet products; otherwise the
 * line's stock quantity in proportion, the rounding remainder on the last row so the rows add up
 * to the line exactly.
 */
export function splitStockQuantities(line: Pick<ShipmentLineDraft, "qtyPurchase" | "qtyStock">, splits: readonly Pick<LineWarehouseSplit, "qtyPurchase">[], sheetLengthM: number | null | undefined): number[] {
  if (sheetLengthM && sheetLengthM > 0) return splits.map((s) => r3(s.qtyPurchase * sheetLengthM));
  if (!(line.qtyPurchase > 0)) return splits.map(() => 0);
  const out = splits.map((s) => r3((line.qtyStock * s.qtyPurchase) / line.qtyPurchase));
  const sumPurchase = splits.reduce((s, x) => s + x.qtyPurchase, 0);
  if (out.length && Math.abs(sumPurchase - line.qtyPurchase) <= EPS) {
    out[out.length - 1] = r3(line.qtyStock - out.slice(0, -1).reduce((s, x) => s + x, 0));
  }
  return out;
}

/** Where a line goes: its split rows, else its own warehouse, else the shipment's default. */
export function effectiveWarehouses(
  line: Pick<ShipmentLineDraft, "qtyPurchase" | "qtyStock" | "warehouseId" | "warehouses">,
  defaultWarehouseId: string | null,
  sheetLengthM: number | null | undefined
): LineWarehouseShare[] {
  const splits = line.warehouses ?? [];
  if (splits.length) {
    const stock = splitStockQuantities(line, splits, sheetLengthM);
    return splits.map((s, i) => ({ warehouseId: s.warehouseId, qtyPurchase: s.qtyPurchase, qtyStock: stock[i], source: "split" as const }));
  }
  return [
    {
      warehouseId: line.warehouseId ?? defaultWarehouseId,
      qtyPurchase: line.qtyPurchase,
      qtyStock: line.qtyStock,
      source: line.warehouseId ? ("line" as const) : ("header" as const),
    },
  ];
}

export type SplitIssue = "warehouse_missing" | "warehouse_duplicate" | "qty_positive" | "whole_sheets" | "sum_mismatch";

export interface SplitCheck {
  /** Line quantity − the rows' sum, in the purchase unit (0 = adds up). */
  remaining: number;
  issues: SplitIssue[];
  /** Row keys with a problem (for the outline in the drawer). */
  badRows: string[];
}

/** Checks a split before it is kept: every row a warehouse (each once), a positive quantity, whole sheets, the sum = the line. */
export function checkSplit(
  line: Pick<ShipmentLineDraft, "qtyPurchase">,
  splits: readonly LineWarehouseSplit[],
  sheetLengthM: number | null | undefined
): SplitCheck {
  const issues = new Set<SplitIssue>();
  const bad = new Set<string>();
  const seen = new Set<string>();
  for (const s of splits) {
    if (!s.warehouseId) {
      issues.add("warehouse_missing");
      bad.add(s.key);
    } else if (seen.has(s.warehouseId)) {
      issues.add("warehouse_duplicate");
      bad.add(s.key);
    } else seen.add(s.warehouseId);
    if (!(s.qtyPurchase > 0)) {
      issues.add("qty_positive");
      bad.add(s.key);
    } else if (sheetLengthM && sheetLengthM > 0 && Math.abs(s.qtyPurchase - Math.round(s.qtyPurchase)) > EPS) {
      issues.add("whole_sheets");
      bad.add(s.key);
    }
  }
  const remaining = r3(line.qtyPurchase - splits.reduce((sum, s) => sum + (Number.isFinite(s.qtyPurchase) ? s.qtyPurchase : 0), 0));
  if (splits.length && Math.abs(remaining) > EPS) issues.add("sum_mismatch");
  return { remaining, issues: [...issues], badRows: [...bad] };
}

/** A split the user is about to edit: the line's current warehouse with everything, and one empty row. */
export function startSplit(line: Pick<ShipmentLineDraft, "qtyPurchase" | "warehouseId" | "warehouses">, defaultWarehouseId: string | null): LineWarehouseSplit[] {
  if (line.warehouses?.length) return line.warehouses.map((s) => ({ ...s }));
  return [
    { key: newSplitKey(), warehouseId: line.warehouseId ?? defaultWarehouseId, qtyPurchase: line.qtyPurchase },
    { key: newSplitKey(), warehouseId: null, qtyPurchase: 0 },
  ];
}

/**
 * The line with a split kept: rows without a quantity are dropped; one row left means one
 * warehouse (the line's own), no split.
 */
export function applySplit<L extends Pick<ShipmentLineDraft, "warehouseId" | "warehouses">>(line: L, splits: readonly LineWarehouseSplit[]): L {
  const rows = splits.filter((s) => s.qtyPurchase > 0);
  if (rows.length <= 1) return { ...line, warehouseId: rows[0]?.warehouseId ?? line.warehouseId, warehouses: [] };
  return { ...line, warehouses: rows.map((s) => ({ ...s })) };
}

/** The line in one warehouse again: the first row's (or its own). */
export function removeSplit<L extends Pick<ShipmentLineDraft, "warehouseId" | "warehouses">>(line: L): L {
  return { ...line, warehouseId: line.warehouses?.[0]?.warehouseId ?? line.warehouseId, warehouses: [] };
}

/** "Apply to all lines": every line into the header warehouse, splits removed. */
export function applyHeaderWarehouse<L extends Pick<ShipmentLineDraft, "warehouseId" | "warehouses">>(lines: readonly L[], warehouseId: string | null): L[] {
  return lines.map((l) => ({ ...l, warehouseId, warehouses: [] }));
}

/**
 * A changed line quantity: a split no longer adds up, so it is kept for the user to fix (the
 * check shows it), except that a split of two rows follows on its last row when it can.
 */
export function followLineQuantity<L extends Pick<ShipmentLineDraft, "qtyPurchase" | "warehouses">>(line: L, qtyPurchase: number): L {
  const splits = line.warehouses ?? [];
  if (splits.length < 2) return { ...line, qtyPurchase };
  const head = splits.slice(0, -1).reduce((s, x) => s + x.qtyPurchase, 0);
  const last = r3(qtyPurchase - head);
  if (!(last > 0)) return { ...line, qtyPurchase };
  return { ...line, qtyPurchase, warehouses: [...splits.slice(0, -1), { ...splits[splits.length - 1], qtyPurchase: last }] };
}

// ── Receipt ────────────────────────────────────────────────────────────────────

export interface ReceivedInto {
  shipmentLineId: string;
  warehouseId: string | null;
  qtyStockUnit: number;
}

export interface PrefillRow {
  shipmentLineId: string;
  warehouseId: string | null;
  /** Still to receive into this warehouse (stock unit). */
  expected: number;
  /** The planned warehouse of this row and what is left of the plan (for "differs from plan"). */
  plannedWarehouseId: string | null;
  plannedQty: number;
}

/**
 * Receive dialog rows: one per planned warehouse with what is still to receive into it (the plan
 * minus what was already received there). When goods went elsewhere earlier, the rows are cut from
 * the last one so they never ask for more than is left of the line.
 */
export function receivePrefill(
  plan: readonly { shipmentLineId: string; orderedStock: number; shares: readonly Pick<LineWarehouseShare, "warehouseId" | "qtyStock">[] }[],
  received: readonly ReceivedInto[]
): PrefillRow[] {
  const out: PrefillRow[] = [];
  for (const line of plan) {
    const mine = received.filter((r) => r.shipmentLineId === line.shipmentLineId);
    const got = mine.reduce((s, r) => s + r.qtyStockUnit, 0);
    let left = r3(Math.max(0, line.orderedStock - got));
    const rows = line.shares.map((s) => {
      const into = mine.filter((r) => r.warehouseId === s.warehouseId).reduce((sum, r) => sum + r.qtyStockUnit, 0);
      return { warehouseId: s.warehouseId, qty: r3(Math.max(0, s.qtyStock - into)) };
    });
    const total = rows.reduce((s, r) => s + r.qty, 0);
    let over = r3(total - left);
    for (let i = rows.length - 1; i >= 0 && over > EPS; i -= 1) {
      const cut = Math.min(rows[i].qty, over);
      rows[i].qty = r3(rows[i].qty - cut);
      over = r3(over - cut);
    }
    for (const r of rows) {
      if (r.qty <= EPS || left <= EPS) continue;
      const qty = Math.min(r.qty, left);
      left = r3(left - qty);
      out.push({ shipmentLineId: line.shipmentLineId, warehouseId: r.warehouseId, expected: qty, plannedWarehouseId: r.warehouseId, plannedQty: qty });
    }
  }
  return out;
}

/** A receive row that is not what the document planned: another warehouse or another quantity. */
export function differsFromPlan(row: { warehouseId: string | null; expected: number; actual: number | null; plannedWarehouseId?: string | null; plannedQty?: number | null }): boolean {
  if (row.plannedWarehouseId === undefined || row.plannedQty === undefined) return false;
  if (row.plannedWarehouseId === null || row.plannedQty === null) return true;
  if (row.warehouseId !== row.plannedWarehouseId) return true;
  return Math.abs((row.actual ?? row.expected) - row.plannedQty) > EPS;
}

/** Split rows from untrusted input (the server action). */
export function parseSplits(value: unknown): LineWarehouseSplit[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((x, i) => {
    const s = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const qty = Number(s.qtyPurchase);
    return {
      key: typeof s.key === "string" && s.key ? s.key.slice(0, 80) : `row-w-${i}`,
      warehouseId: typeof s.warehouseId === "string" && /^[0-9a-f-]{36}$/i.test(s.warehouseId) ? s.warehouseId : null,
      qtyPurchase: Number.isFinite(qty) ? qty : 0,
    };
  });
}
