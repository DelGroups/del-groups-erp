/**
 * Checks of a landed cost the "Maya dəyəri" tab shows (IMP-4). Pure.
 *
 * - Column totals are the sums of the allocated cells, never the cost's own amount: a cost that
 *   is not (fully) split shows its unallocated difference next to the total, so the table, the
 *   footer and the grand total always agree.
 * - Plausibility warnings never block: a cost larger than the goods, a landed unit cost more than
 *   3 × the goods unit cost, a rate more than 5 % away from the CBAR rate of that date.
 * - The suggested sale price from a margin on the sale price is only a suggestion.
 */
import { fromCents, toCents, type LandedCostResult } from "@/lib/imports/landedCost";
import { cbarKey, customsRateState, rateLooksWrong } from "./rates";
import type { ShipmentDraft } from "./shipment";

export interface CostColumnTotal {
  costId: string;
  /** Sum of the cells of the column (AZN). */
  allocatedAzn: number;
  /** The cost in AZN. */
  amountAzn: number;
  /** amount − allocated; 0 when the whole cost is in the landed cost. */
  unallocatedAzn: number;
}

/** Footer of each capitalized cost column: the sum of its cells and what was not split. */
export function costColumnTotals(result: LandedCostResult): CostColumnTotal[] {
  return result.costs
    .filter((c) => c.capitalized)
    .map((c) => {
      const allocated = result.lines.reduce((s, l) => s + toCents(l.allocations[c.id] ?? 0), 0);
      // A manual split reports the typed sum as its amount; the mismatch is the part not split.
      const mismatch = result.errors.find((e) => e.code === "manual_mismatch" && e.costId === c.id)?.amount ?? 0;
      const amount = toCents(c.amountAzn) + toCents(mismatch);
      return { costId: c.id, allocatedAzn: fromCents(allocated), amountAzn: fromCents(amount), unallocatedAzn: fromCents(amount - allocated) };
    });
}

/** Grand totals rebuilt from the cells (goods + every cost column = landed), for the footer and the summary. */
export function reconciledTotals(result: LandedCostResult): { goodsAzn: number; costsAzn: number; landedAzn: number; unallocatedAzn: number; reconciles: boolean } {
  const goods = result.lines.reduce((s, l) => s + toCents(l.goodsAzn), 0);
  const columns = costColumnTotals(result);
  const costs = columns.reduce((s, c) => s + toCents(c.allocatedAzn), 0);
  const landed = result.lines.reduce((s, l) => s + toCents(l.landedAzn), 0);
  const unallocated = columns.reduce((s, c) => s + toCents(c.unallocatedAzn), 0);
  return {
    goodsAzn: fromCents(goods),
    costsAzn: fromCents(costs),
    landedAzn: fromCents(landed),
    unallocatedAzn: fromCents(unallocated),
    reconciles: goods + costs === landed && landed === toCents(result.totals.landedAzn),
  };
}

// ── Plausibility ──────────────────────────────────────────────────────────────

export type PlausibilityCode = "cost_over_goods" | "landed_over_3x" | "rate_off_cbar";

export interface PlausibilityWarning {
  code: PlausibilityCode;
  /** Cost row key (cost_over_goods, rate_off_cbar on a cost). */
  costId?: string;
  /** Product line key (landed_over_3x). */
  lineId?: string;
  /** "invoice" | "customs" | a cost key (rate_off_cbar). */
  rate?: string;
}

/** A landed unit cost more than this many times the goods unit cost is worth a look. */
export const LANDED_OVER_GOODS_FACTOR = 3;

/**
 * Non-blocking warnings. `cbar` holds the CBAR rates the form has seen this session
 * (cbarKey(currency, date) → rate); a rate is only compared when its CBAR rate is known.
 */
export function plausibilityWarnings(
  draft: Pick<ShipmentDraft, "currencyCode" | "invoiceRate" | "invoiceDate" | "customsRate" | "customsDeclarationDate" | "costs">,
  result: LandedCostResult,
  cbar: Readonly<Record<string, number>> = {}
): PlausibilityWarning[] {
  const out: PlausibilityWarning[] = [];
  const goods = toCents(result.totals.goodsAzn);
  for (const c of result.costs) {
    if (goods > 0 && toCents(c.amountAzn) > goods) out.push({ code: "cost_over_goods", costId: c.id });
  }
  for (const l of result.lines) {
    if (l.goodsAzn > 0 && l.landedAzn > l.goodsAzn * LANDED_OVER_GOODS_FACTOR + 0.005) out.push({ code: "landed_over_3x", lineId: l.id });
  }
  if (draft.currencyCode !== "AZN") {
    if (draft.invoiceDate && rateLooksWrong(draft.invoiceRate, cbar[cbarKey(draft.currencyCode, draft.invoiceDate)])) out.push({ code: "rate_off_cbar", rate: "invoice" });
    const customs = customsRateState(draft);
    if (customs.source === "own" && draft.customsDeclarationDate && rateLooksWrong(customs.rate, cbar[cbarKey(draft.currencyCode, draft.customsDeclarationDate)])) {
      out.push({ code: "rate_off_cbar", rate: "customs" });
    }
  }
  const costDate = draft.customsDeclarationDate ?? draft.invoiceDate;
  for (const c of draft.costs) {
    if (c.currencyCode === "AZN" || !costDate || c.splitMethod === "per_line_duty") continue;
    if (rateLooksWrong(c.rateToAzn, cbar[cbarKey(c.currencyCode, costDate)])) out.push({ code: "rate_off_cbar", costId: c.key, rate: c.key });
  }
  return out;
}

// ── Sale price suggestion ─────────────────────────────────────────────────────

/** Price from a margin on the sale price: cost / (1 − margin). Null outside 0 ≤ margin < 100. */
export function priceFromMargin(cost: number, marginPct: number | null | undefined): number | null {
  if (marginPct === null || marginPct === undefined || !Number.isFinite(marginPct) || marginPct < 0 || marginPct >= 100) return null;
  return fromCents(toCents(cost / (1 - marginPct / 100)));
}

/** The markup on cost that a margin on the sale price gives: margin / (1 − margin), in %. */
export function markupFromMargin(marginPct: number | null | undefined): number | null {
  if (marginPct === null || marginPct === undefined || !Number.isFinite(marginPct) || marginPct < 0 || marginPct >= 100) return null;
  return Math.round((marginPct / (100 - marginPct)) * 100 * 10) / 10;
}
