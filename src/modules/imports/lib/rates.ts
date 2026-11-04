/**
 * Exchange rates of an import form (IMP-4): the customs rate follows the invoice rate until the
 * user gives it its own value, and the list of every rate "Refresh all rates" asks CBAR for. Pure.
 *
 * Follow rule (Del, 2026-11-04): until a customs declaration date is entered, the customs rate is
 * the invoice rate ("from the invoice"), and it stays editable. A typed customs rate, or one
 * fetched for the declaration date, is the shipment's own and no longer follows. Stored as
 * `customsRate = null` while it follows, so a saved draft keeps following.
 */
import type { ImportCurrency } from "@/lib/imports/cbar";
import type { ShipmentDraft } from "./shipment";

export type CustomsRateSource = "invoice" | "own";

export interface CustomsRateState {
  /** The rate the form shows and the cost sheet prints. */
  rate: number;
  source: CustomsRateSource;
  /** The date the rate belongs to: the declaration date when the rate is its own, else the invoice date. */
  date: string | null;
}

type RateFields = Pick<ShipmentDraft, "currencyCode" | "invoiceRate" | "invoiceDate" | "customsRate" | "customsDeclarationDate">;

/** The customs rate as shown: its own value, or the invoice rate while it follows. AZN is always 1. */
export function customsRateState(d: RateFields): CustomsRateState {
  if (d.currencyCode === "AZN") return { rate: 1, source: "own", date: d.customsDeclarationDate ?? d.invoiceDate };
  if (d.customsRate !== null && d.customsRate > 0) return { rate: d.customsRate, source: "own", date: d.customsDeclarationDate ?? d.invoiceDate };
  return { rate: d.invoiceRate, source: "invoice", date: d.invoiceDate };
}

/** A typed customs rate: its own from now on; an emptied field goes back to following the invoice. */
export function typeCustomsRate<T extends RateFields>(d: T, rate: number | null): T {
  return { ...d, customsRate: rate !== null && rate > 0 ? rate : null };
}

/**
 * A new declaration date. While the rate still follows, the caller should fetch CBAR for the new
 * date (`fetchCustomsRate` true); a rate the user typed is left alone.
 */
export function setDeclarationDate<T extends RateFields>(d: T, date: string | null): { draft: T; fetchCustomsRate: boolean } {
  const following = customsRateState(d).source === "invoice";
  return { draft: { ...d, customsDeclarationDate: date }, fetchCustomsRate: d.currencyCode !== "AZN" && following && !!date };
}

/** A new currency: AZN has rate 1 on both; another currency keeps the typed rates. */
export function setCurrency<T extends RateFields>(d: T, currency: ImportCurrency): T {
  return currency === "AZN" ? { ...d, currencyCode: currency, invoiceRate: 1, customsRate: null } : { ...d, currencyCode: currency };
}

/** One rate "Refresh all rates" asks for. */
export interface RateTarget {
  /** "invoice", "customs" or a cost row key. */
  target: string;
  currency: ImportCurrency;
  /** yyyy-mm-dd; today when the document has no date yet. */
  date: string;
}

/**
 * Every foreign-currency rate of the form: the invoice rate (invoice date), the customs rate
 * (declaration date, only once one is entered: before that it follows the invoice) and each cost
 * in another currency (declaration date, else invoice date, as the per-cost refresh does).
 */
export function rateTargets(d: Pick<ShipmentDraft, "currencyCode" | "invoiceDate" | "customsDeclarationDate" | "costs">, today: string): RateTarget[] {
  const out: RateTarget[] = [];
  if (d.currencyCode !== "AZN") {
    out.push({ target: "invoice", currency: d.currencyCode, date: d.invoiceDate ?? today });
    if (d.customsDeclarationDate) out.push({ target: "customs", currency: d.currencyCode, date: d.customsDeclarationDate });
  }
  for (const c of d.costs) {
    if (c.currencyCode === "AZN" || c.splitMethod === "per_line_duty") continue;
    out.push({ target: c.key, currency: c.currencyCode, date: d.customsDeclarationDate ?? d.invoiceDate ?? today });
  }
  return out;
}

/** How far a rate is from CBAR's, in % of CBAR's (positive: above). Null without both rates. */
export function rateDeviationPct(rate: number, cbarRate: number | null | undefined): number | null {
  if (!(rate > 0) || !cbarRate || !(cbarRate > 0)) return null;
  return ((rate - cbarRate) / cbarRate) * 100;
}

/** More than 5 % away from the CBAR rate of that date: worth a second look (never blocks). */
export const RATE_DEVIATION_LIMIT_PCT = 5;

export function rateLooksWrong(rate: number, cbarRate: number | null | undefined): boolean {
  const dev = rateDeviationPct(rate, cbarRate);
  return dev !== null && Math.abs(dev) > RATE_DEVIATION_LIMIT_PCT + 1e-9;
}

/** Key of a CBAR rate the form has seen: currency and the day it was asked for. */
export const cbarKey = (currency: string, date: string) => `${currency}:${date}`;
