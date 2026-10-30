/**
 * Landed cost of an import shipment (Imports module, IMP-1). Pure: no database access, so the form
 * computes it live and tests check it exactly.
 *
 * Steps:
 *   1. every amount to AZN with its own rate (goods at the invoice rate);
 *   2. customs value per line = goods + the capitalized costs of the "customs value" types
 *      (international freight and insurance by default), each split by its own method;
 *   3. customs duty per line = line customs value × duty_rate_pct (method per_line_duty);
 *   4. every other capitalized cost split by its own method;
 *   5. customs VAT suggestion = rate × (customs value + duty), recoverable, never capitalized.
 * VAT amounts are never part of the landed cost. Each cost is split in cents, rounded to the
 * nearest cent, and the remainder goes to the line with the largest share, so every split adds
 * up exactly to its cost.
 */

export const COST_TYPES = [
  "freight_international",
  "insurance",
  "customs_duty",
  "customs_fee",
  "customs_vat",
  "broker",
  "freight_local",
  "labour",
  "storage",
  "other",
] as const;
export type CostType = (typeof COST_TYPES)[number];

export const SPLIT_METHODS = [
  "by_value",
  "by_quantity",
  "by_weight",
  "by_volume",
  "chargeable_weight",
  "equal",
  "per_line_duty",
  "manual",
] as const;
export type SplitMethod = (typeof SPLIT_METHODS)[number];

export interface LandedCostSettings {
  /** Customs VAT in % of (customs value + duty). */
  customsVatRatePct: number;
  /** kg per m³ for chargeable weight (road/sea: 333). */
  chargeableFactor: number;
  /** Capitalized cost types that are part of the customs value. */
  customsValueCostTypes: readonly CostType[];
}

export const DEFAULT_LANDED_COST_SETTINGS: LandedCostSettings = {
  customsVatRatePct: 18,
  chargeableFactor: 333,
  customsValueCostTypes: ["freight_international", "insurance"],
};

export interface LandedCostLineInput {
  id: string;
  /** Quantity in the purchase unit (sheets, rolls, pieces). */
  qtyPurchase: number;
  /** Quantity in the stock unit (metres for sheet products = sheets × sheet length). */
  qtyStock: number;
  /** Price per purchase unit in the shipment currency. */
  unitPriceFc: number;
  /** Total weight of the line, kg. */
  weightKg?: number | null;
  /** Total volume of the line, m³. */
  volumeM3?: number | null;
  dutyRatePct?: number | null;
}

export interface LandedCostCostInput {
  id: string;
  costType: CostType;
  /** In the cost's own currency; ignored for per_line_duty (computed). */
  amount: number;
  /** AZN per unit of the cost's currency (1 for AZN). */
  rateToAzn: number;
  /** Recoverable VAT on this cost, already in AZN (never capitalized). */
  vatAmountAzn?: number | null;
  isCapitalized: boolean;
  splitMethod: SplitMethod;
  /** Amount per shipment line id for the manual method, in AZN. */
  manual?: Readonly<Record<string, number>> | null;
}

export interface LandedCostInput {
  /** AZN per unit of the shipment currency. */
  invoiceRate: number;
  lines: readonly LandedCostLineInput[];
  costs: readonly LandedCostCostInput[];
  settings?: Partial<LandedCostSettings>;
  /** Margin for the suggested sale price, % of the sale price (0 ≤ margin < 100). */
  marginPct?: number | null;
}

export type LandedCostIssueCode =
  | "no_lines"
  | "missing_weight"
  | "missing_volume"
  | "missing_chargeable"
  | "method_not_for_type"
  | "manual_mismatch"
  | "zero_basis";

export interface LandedCostIssue {
  code: LandedCostIssueCode;
  costId?: string;
  /** For manual_mismatch: the difference in AZN (cost − typed sum). */
  amount?: number;
}

export interface LandedCostLineResult {
  id: string;
  goodsAzn: number;
  customsValueAzn: number;
  /** Duty from the line's rate (part of the landed cost through a customs_duty cost line). */
  dutyAzn: number;
  /** AZN per cost line id (capitalized costs only). */
  allocations: Record<string, number>;
  landedAzn: number;
  unitCostPurchase: number;
  unitCostStock: number;
  suggestedPricePurchase: number | null;
  suggestedPriceStock: number | null;
}

export interface LandedCostCostResult {
  id: string;
  costType: CostType;
  amountAzn: number;
  vatAzn: number;
  capitalized: boolean;
  /** The method actually used (a fallback when data was missing). */
  method: SplitMethod;
  /** AZN per shipment line id; empty when not capitalized. */
  allocations: Record<string, number>;
}

export interface LandedCostTotals {
  goodsAzn: number;
  customsValueAzn: number;
  dutyAzn: number;
  capitalizedAzn: number;
  recoverableVatAzn: number;
  customsVatSuggestionAzn: number;
  landedAzn: number;
}

export interface LandedCostResult {
  lines: LandedCostLineResult[];
  costs: LandedCostCostResult[];
  totals: LandedCostTotals;
  /** Fallbacks the user should know about (allocation still adds up). */
  warnings: LandedCostIssue[];
  /** Must be fixed before the shipment is saved (a manual split that does not add up). */
  errors: LandedCostIssue[];
}

// ── Money in cents ──────────────────────────────────────────────────────────

const finite = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Nearest cent (half away from zero), without binary noise such as 1.005 → 1.00. */
export function toCents(value: number): number {
  const v = finite(value);
  return Math.sign(v) * Math.round(Math.abs(v) * 100 + 1e-7);
}

export const fromCents = (cents: number) => cents / 100;

export function round2(value: number): number {
  return fromCents(toCents(value));
}

/**
 * Splits `totalCents` by `weights`: each share rounded to the nearest cent, the remainder to the
 * line with the largest weight (the first one on a tie), so the shares add up exactly.
 * Returns null when the weights add up to zero.
 */
export function allocateCents(totalCents: number, weights: readonly number[]): number[] | null {
  const sum = weights.reduce((s, w) => s + Math.max(0, finite(w)), 0);
  if (!(sum > 0)) return null;
  const shares = weights.map((w) => toCents((totalCents / 100) * (Math.max(0, finite(w)) / sum)));
  const diff = totalCents - shares.reduce((s, c) => s + c, 0);
  if (diff !== 0) {
    let largest = 0;
    weights.forEach((w, i) => {
      if (finite(w) > finite(weights[largest])) largest = i;
    });
    shares[largest] += diff;
  }
  return shares;
}

// ── Calculator ──────────────────────────────────────────────────────────────

const positive = (v: number | null | undefined) => finite(v) > 0;

/** The basis of a method for every line, or a fallback to by_value with the warning to show. */
function basisFor(
  method: SplitMethod,
  lines: readonly LandedCostLineInput[],
  goodsCents: readonly number[],
  factor: number
): { weights: number[]; method: SplitMethod; warning?: LandedCostIssueCode } {
  const byValue = { weights: goodsCents.map((c) => c), method: "by_value" as SplitMethod };
  switch (method) {
    case "by_value":
      return byValue;
    case "by_quantity":
      return { weights: lines.map((l) => finite(l.qtyPurchase)), method };
    case "equal":
      return { weights: lines.map(() => 1), method };
    case "by_weight":
      return lines.every((l) => positive(l.weightKg))
        ? { weights: lines.map((l) => finite(l.weightKg)), method }
        : { ...byValue, warning: "missing_weight" };
    case "by_volume":
      return lines.every((l) => positive(l.volumeM3))
        ? { weights: lines.map((l) => finite(l.volumeM3)), method }
        : { ...byValue, warning: "missing_volume" };
    case "chargeable_weight": {
      const weights = lines.map((l) => Math.max(finite(l.weightKg), finite(l.volumeM3) * factor));
      return weights.every((w) => w > 0) ? { weights, method } : { ...byValue, warning: "missing_chargeable" };
    }
    default:
      // per_line_duty and manual are handled by the caller.
      return { ...byValue, warning: "method_not_for_type" };
  }
}

export function calculateLandedCost(input: LandedCostInput): LandedCostResult {
  const settings: LandedCostSettings = { ...DEFAULT_LANDED_COST_SETTINGS, ...(input.settings ?? {}) };
  const lines = input.lines;
  const warnings: LandedCostIssue[] = [];
  const errors: LandedCostIssue[] = [];
  if (lines.length === 0) warnings.push({ code: "no_lines" });

  const goodsCents = lines.map((l) => toCents(finite(l.qtyPurchase) * finite(l.unitPriceFc) * finite(input.invoiceRate)));
  const allocations = lines.map(() => ({}) as Record<string, number>);
  const costResults = new Map<string, LandedCostCostResult>();

  // Each cost's AZN amount, VAT and whether it is capitalized (customs VAT and VAT never are).
  const prepared = input.costs.map((c) => {
    const capitalized = c.isCapitalized && c.costType !== "customs_vat";
    return { cost: c, capitalized, amountCents: toCents(finite(c.amount) * (finite(c.rateToAzn) || 1)) };
  });

  const record = (p: (typeof prepared)[number], method: SplitMethod, shares: number[] | null, amountCents = p.amountCents) => {
    const alloc: Record<string, number> = {};
    if (shares) {
      shares.forEach((cents, i) => {
        alloc[lines[i].id] = fromCents(cents);
        allocations[i][p.cost.id] = (allocations[i][p.cost.id] ?? 0) + cents;
      });
    }
    const vatCents = toCents(finite(p.cost.vatAmountAzn));
    costResults.set(p.cost.id, {
      id: p.cost.id,
      costType: p.cost.costType,
      amountAzn: fromCents(amountCents),
      vatAzn: fromCents(p.cost.costType === "customs_vat" ? amountCents + vatCents : vatCents),
      capitalized: p.capitalized,
      method,
      allocations: alloc,
    });
  };

  const split = (p: (typeof prepared)[number]) => {
    const method = p.cost.splitMethod;
    if (method === "manual") {
      const typed = lines.map((l) => toCents(finite(p.cost.manual?.[l.id])));
      const diff = p.amountCents - typed.reduce((s, c) => s + c, 0);
      if (diff !== 0) errors.push({ code: "manual_mismatch", costId: p.cost.id, amount: fromCents(diff) });
      record(p, method, lines.length ? typed : null, typed.reduce((s, c) => s + c, 0));
      return;
    }
    const basis = basisFor(method, lines, goodsCents, settings.chargeableFactor);
    if (basis.warning) warnings.push({ code: basis.warning, costId: p.cost.id });
    const shares = lines.length ? allocateCents(p.amountCents, basis.weights) : null;
    if (lines.length && !shares && p.amountCents !== 0) warnings.push({ code: "zero_basis", costId: p.cost.id });
    record(p, basis.method, shares);
  };

  const inCustomsValue = (p: (typeof prepared)[number]) =>
    p.capitalized && settings.customsValueCostTypes.includes(p.cost.costType) && p.cost.splitMethod !== "per_line_duty";
  const isDuty = (p: (typeof prepared)[number]) => p.cost.costType === "customs_duty" && p.cost.splitMethod === "per_line_duty";

  // 1. Costs that make up the customs value.
  for (const p of prepared.filter(inCustomsValue)) split(p);
  const customsValueCents = lines.map((_, i) => {
    let cents = goodsCents[i];
    for (const p of prepared.filter(inCustomsValue)) cents += allocations[i][p.cost.id] ?? 0;
    return cents;
  });

  // 2. Customs duty per line from each line's rate.
  const dutyCents = lines.map((l, i) => toCents(fromCents(customsValueCents[i]) * (finite(l.dutyRatePct) / 100)));
  for (const p of prepared.filter(isDuty)) {
    const total = dutyCents.reduce((s, c) => s + c, 0);
    record(p, "per_line_duty", p.capitalized && lines.length ? dutyCents : null, total);
  }
  // per_line_duty on another cost type cannot be computed: split by value with a warning.
  for (const p of prepared.filter((x) => x.cost.splitMethod === "per_line_duty" && !isDuty(x))) {
    warnings.push({ code: "method_not_for_type", costId: p.cost.id });
    const shares = p.capitalized && lines.length ? allocateCents(p.amountCents, goodsCents) : null;
    record(p, "by_value", shares);
  }

  // 3. Every other capitalized cost by its own method; costs not capitalized are only recorded.
  for (const p of prepared) {
    if (costResults.has(p.cost.id)) continue;
    if (!p.capitalized) record(p, p.cost.splitMethod, null);
    else split(p);
  }

  const margin = finite(input.marginPct);
  const withMargin = (cost: number) => (input.marginPct == null || margin < 0 || margin >= 100 ? null : round2(cost / (1 - margin / 100)));

  const lineResults: LandedCostLineResult[] = lines.map((l, i) => {
    const costCents = Object.values(allocations[i]).reduce((s, c) => s + c, 0);
    const landedCents = goodsCents[i] + costCents;
    const landed = fromCents(landedCents);
    const unitPurchase = positive(l.qtyPurchase) ? landed / finite(l.qtyPurchase) : 0;
    const unitStock = positive(l.qtyStock) ? landed / finite(l.qtyStock) : unitPurchase;
    const alloc: Record<string, number> = {};
    for (const [id, cents] of Object.entries(allocations[i])) alloc[id] = fromCents(cents);
    return {
      id: l.id,
      goodsAzn: fromCents(goodsCents[i]),
      customsValueAzn: fromCents(customsValueCents[i]),
      dutyAzn: fromCents(dutyCents[i]),
      allocations: alloc,
      landedAzn: landed,
      unitCostPurchase: unitPurchase,
      unitCostStock: unitStock,
      suggestedPricePurchase: withMargin(unitPurchase),
      suggestedPriceStock: withMargin(unitStock),
    };
  });

  const costs = input.costs.map((c) => costResults.get(c.id) as LandedCostCostResult);
  const sumCents = (values: number[]) => values.reduce((s, v) => s + toCents(v), 0);
  const goodsTotal = goodsCents.reduce((s, c) => s + c, 0);
  const customsValueTotal = customsValueCents.reduce((s, c) => s + c, 0);
  const dutyTotal = dutyCents.reduce((s, c) => s + c, 0);
  const capitalized = lineResults.reduce((s, l) => s + toCents(l.landedAzn), 0) - goodsTotal;

  return {
    lines: lineResults,
    costs,
    totals: {
      goodsAzn: fromCents(goodsTotal),
      customsValueAzn: fromCents(customsValueTotal),
      dutyAzn: fromCents(dutyTotal),
      capitalizedAzn: fromCents(capitalized),
      recoverableVatAzn: fromCents(sumCents(costs.map((c) => c.vatAzn))),
      customsVatSuggestionAzn: round2(fromCents(customsValueTotal + dutyTotal) * (finite(settings.customsVatRatePct) / 100)),
      landedAzn: fromCents(goodsTotal + capitalized),
    },
    warnings,
    errors,
  };
}

/** Stock quantity of a line: sheets × sheet length for sheet products (metres), else the purchase quantity. */
export function stockQuantity(qtyPurchase: number, sheetLengthM: number | null | undefined): number {
  const q = finite(qtyPurchase);
  return positive(sheetLengthM) ? Math.round(q * finite(sheetLengthM) * 1000) / 1000 : q;
}
