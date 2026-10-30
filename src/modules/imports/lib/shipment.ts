/**
 * An import shipment as the form edits it (IMP-1), its checks and its landed cost. Pure: the form
 * and the server action use the same functions, so the panel shows exactly what is saved.
 */
import { isImportCurrency, type ImportCurrency } from "@/lib/imports/cbar";
import { methodsFor, type ImportsConfig } from "@/lib/imports/config";
import {
  calculateLandedCost,
  COST_TYPES,
  stockQuantity,
  type CostType,
  type LandedCostInput,
  type LandedCostResult,
  type SplitMethod,
} from "@/lib/imports/landedCost";

export const SHIPMENT_STATUSES = ["draft", "confirmed", "cleared", "partially_received", "received", "closed", "cancelled"] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const INCOTERMS = ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"] as const;
export type Incoterm = (typeof INCOTERMS)[number];

/** What the form needs to know about a product. */
export interface ImportProduct {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  /** Metres per sheet for sheet products (stock kept in metres), else null. */
  sheetLengthM: number | null;
  /** For the receiving sheet (IMP-2). */
  barcode?: string | null;
}

export interface ShipmentLineDraft {
  /** Row id: the stored id, or a temporary one for a new row. */
  key: string;
  productId: string;
  qtyPurchase: number;
  purchaseUnit: string | null;
  /** Metres for sheet products; computed from the product, editable for others. */
  qtyStock: number;
  unitPriceFc: number;
  weightKg: number | null;
  volumeM3: number | null;
  hsCode: string | null;
  dutyRatePct: number;
  warehouseId: string | null;
}

export interface CostLineDraft {
  key: string;
  costType: CostType;
  partnerId: string | null;
  description: string | null;
  amount: number;
  currencyCode: ImportCurrency;
  rateToAzn: number;
  vatAmountAzn: number;
  isCapitalized: boolean;
  splitMethod: SplitMethod;
  isEstimate: boolean;
  paidNow: boolean;
  cashAccountId: string | null;
  /** Manual split: AZN per shipment line key. */
  manual: Record<string, number>;
}

export interface ShipmentDraft {
  id: string | null;
  number: string | null;
  status: ShipmentStatus;
  supplierId: string | null;
  currencyCode: ImportCurrency;
  invoiceNo: string | null;
  invoiceDate: string | null;
  invoiceRate: number;
  /** Set on confirmation with supplier prepayments (IMP-3): AZN per unit for the goods. */
  goodsRateAzn?: number | null;
  incoterm: Incoterm | null;
  customsDeclarationNo: string | null;
  customsDeclarationDate: string | null;
  customsRate: number | null;
  defaultWarehouseId: string | null;
  notes: string | null;
  lines: ShipmentLineDraft[];
  costs: CostLineDraft[];
}

export function emptyShipment(): ShipmentDraft {
  return {
    id: null,
    number: null,
    status: "draft",
    supplierId: null,
    currencyCode: "USD",
    invoiceNo: null,
    invoiceDate: null,
    invoiceRate: 1,
    incoterm: null,
    customsDeclarationNo: null,
    customsDeclarationDate: null,
    customsRate: null,
    defaultWarehouseId: null,
    notes: null,
    lines: [],
    costs: [],
  };
}

let keySeq = 0;
/** A temporary key for a new row (not a uuid, so it is never mistaken for a stored id). */
export function newRowKey(prefix: "l" | "c"): string {
  keySeq += 1;
  return `new-${prefix}-${Date.now().toString(36)}-${keySeq}`;
}

/** A new product line: stock quantity in metres for sheet products. */
export function newLine(product: ImportProduct, qty = 1): ShipmentLineDraft {
  return {
    key: newRowKey("l"),
    productId: product.id,
    qtyPurchase: qty,
    purchaseUnit: product.unit,
    qtyStock: stockQuantity(qty, product.sheetLengthM),
    unitPriceFc: 0,
    weightKg: null,
    volumeM3: null,
    hsCode: null,
    dutyRatePct: 0,
    warehouseId: null,
  };
}

/** A new cost line with the defaults of its type (settings page). */
export function newCost(costType: CostType, config: ImportsConfig): CostLineDraft {
  const defaults = config.costTypes[costType];
  return {
    key: newRowKey("c"),
    costType,
    partnerId: defaults.defaultPartnerId,
    description: null,
    amount: 0,
    currencyCode: "AZN",
    rateToAzn: 1,
    vatAmountAzn: 0,
    isCapitalized: costType === "customs_vat" ? false : defaults.defaultCapitalized,
    splitMethod: defaults.defaultMethod,
    isEstimate: false,
    paidNow: false,
    cashAccountId: null,
    manual: {},
  };
}

/** VAT of a cost in AZN at the cost type's default rate (the user can change it). */
export function suggestedVat(cost: Pick<CostLineDraft, "amount" | "rateToAzn" | "costType">, config: ImportsConfig): number {
  const rate = config.costTypes[cost.costType].defaultVatRatePct;
  return Math.round(cost.amount * cost.rateToAzn * rate) / 100;
}

/** The calculator's input for a draft (cost and line ids are the row keys). */
export function landedCostInput(draft: ShipmentDraft, config: ImportsConfig, marginPct?: number | null): LandedCostInput {
  return {
    // Prepaid goods are valued at the prepayment rate (IMP-3): the effective goods rate, once set.
    invoiceRate: draft.goodsRateAzn ?? draft.invoiceRate,
    lines: draft.lines.map((l) => ({
      id: l.key,
      qtyPurchase: l.qtyPurchase,
      qtyStock: l.qtyStock,
      unitPriceFc: l.unitPriceFc,
      weightKg: l.weightKg,
      volumeM3: l.volumeM3,
      dutyRatePct: l.dutyRatePct,
    })),
    costs: draft.costs.map((c) => ({
      id: c.key,
      costType: c.costType,
      amount: c.amount,
      rateToAzn: c.currencyCode === "AZN" ? 1 : c.rateToAzn,
      vatAmountAzn: c.vatAmountAzn,
      isCapitalized: c.isCapitalized,
      splitMethod: c.splitMethod,
      manual: c.manual,
    })),
    settings: config,
    marginPct,
  };
}

export function landedCostOf(draft: ShipmentDraft, config: ImportsConfig, marginPct?: number | null): LandedCostResult {
  return calculateLandedCost(landedCostInput(draft, config, marginPct));
}

// ── Checks ──────────────────────────────────────────────────────────────────

export type DraftIssue =
  | "supplier_required"
  | "rate_required"
  | "line_product"
  | "line_quantity"
  | "line_price"
  | "line_duty"
  | "cost_amount"
  | "cost_rate"
  | "cost_method"
  | "cost_paid_account"
  | "manual_mismatch"
  | "not_draft";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

const ok = (n: unknown) => typeof n === "number" && Number.isFinite(n);

/** The problems that stop a draft from being saved (empty list = fine). */
export function draftIssues(draft: ShipmentDraft, config: ImportsConfig): DraftIssue[] {
  const issues = new Set<DraftIssue>();
  if (draft.status !== "draft") issues.add("not_draft");
  if (!isUuid(draft.supplierId)) issues.add("supplier_required");
  if (!ok(draft.invoiceRate) || draft.invoiceRate <= 0) issues.add("rate_required");
  for (const l of draft.lines) {
    if (!isUuid(l.productId)) issues.add("line_product");
    if (!ok(l.qtyPurchase) || l.qtyPurchase <= 0 || !ok(l.qtyStock) || l.qtyStock <= 0) issues.add("line_quantity");
    if (!ok(l.unitPriceFc) || l.unitPriceFc < 0) issues.add("line_price");
    if (!ok(l.dutyRatePct) || l.dutyRatePct < 0 || l.dutyRatePct > 100) issues.add("line_duty");
  }
  for (const c of draft.costs) {
    if (!ok(c.amount) || c.amount < 0 || !ok(c.vatAmountAzn) || c.vatAmountAzn < 0) issues.add("cost_amount");
    if (c.currencyCode !== "AZN" && (!ok(c.rateToAzn) || c.rateToAzn <= 0)) issues.add("cost_rate");
    if (!methodsFor(c.costType).includes(c.splitMethod)) issues.add("cost_method");
    if (c.paidNow && !isUuid(c.cashAccountId)) issues.add("cost_paid_account");
  }
  if (landedCostOf(draft, config).errors.some((e) => e.code === "manual_mismatch")) issues.add("manual_mismatch");
  return [...issues];
}

// ── Parsing what the client sends ───────────────────────────────────────────

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const numOr = (v: unknown, fallback: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const numOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const isoDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const uuidOrNull = (v: unknown) => (isUuid(v) ? v : null);
const pick = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback);

/** A draft from untrusted input (server action), with every field normalised. */
export function parseShipmentDraft(value: unknown): ShipmentDraft {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const lines = Array.isArray(raw.lines) ? raw.lines.slice(0, 500) : [];
  const costs = Array.isArray(raw.costs) ? raw.costs.slice(0, 200) : [];
  return {
    id: uuidOrNull(raw.id),
    number: text(raw.number, 40),
    status: pick(raw.status, SHIPMENT_STATUSES, "draft"),
    supplierId: uuidOrNull(raw.supplierId),
    currencyCode: isImportCurrency(raw.currencyCode) ? raw.currencyCode : "USD",
    invoiceNo: text(raw.invoiceNo, 100),
    invoiceDate: isoDate(raw.invoiceDate),
    invoiceRate: numOr(raw.invoiceRate, 0),
    incoterm: typeof raw.incoterm === "string" && (INCOTERMS as readonly string[]).includes(raw.incoterm) ? (raw.incoterm as Incoterm) : null,
    customsDeclarationNo: text(raw.customsDeclarationNo, 100),
    customsDeclarationDate: isoDate(raw.customsDeclarationDate),
    customsRate: numOrNull(raw.customsRate),
    defaultWarehouseId: uuidOrNull(raw.defaultWarehouseId),
    notes: text(raw.notes, 10000),
    lines: lines.map((x, i) => {
      const l = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      return {
        key: typeof l.key === "string" && l.key ? l.key.slice(0, 80) : `row-l-${i}`,
        productId: typeof l.productId === "string" ? l.productId : "",
        qtyPurchase: numOr(l.qtyPurchase, 0),
        purchaseUnit: text(l.purchaseUnit, 40),
        qtyStock: numOr(l.qtyStock, 0),
        unitPriceFc: numOr(l.unitPriceFc, 0),
        weightKg: numOrNull(l.weightKg),
        volumeM3: numOrNull(l.volumeM3),
        hsCode: text(l.hsCode, 20),
        dutyRatePct: numOr(l.dutyRatePct, 0),
        warehouseId: uuidOrNull(l.warehouseId),
      };
    }),
    costs: costs.map((x, i) => {
      const c = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      const costType = pick(c.costType, COST_TYPES, "other");
      const manualRaw = c.manual && typeof c.manual === "object" ? (c.manual as Record<string, unknown>) : {};
      const manual: Record<string, number> = {};
      for (const [k, v] of Object.entries(manualRaw)) if (Number.isFinite(Number(v))) manual[k.slice(0, 80)] = Number(v);
      return {
        key: typeof c.key === "string" && c.key ? c.key.slice(0, 80) : `row-c-${i}`,
        costType,
        partnerId: uuidOrNull(c.partnerId),
        description: text(c.description, 500),
        amount: numOr(c.amount, 0),
        currencyCode: isImportCurrency(c.currencyCode) ? c.currencyCode : "AZN",
        rateToAzn: numOr(c.rateToAzn, 1),
        vatAmountAzn: numOr(c.vatAmountAzn, 0),
        isCapitalized: costType === "customs_vat" ? false : c.isCapitalized !== false,
        splitMethod: typeof c.splitMethod === "string" ? (c.splitMethod as SplitMethod) : "by_value",
        isEstimate: c.isEstimate === true,
        paidNow: c.paidNow === true,
        cashAccountId: uuidOrNull(c.cashAccountId),
        manual,
      };
    }),
  };
}
