/**
 * Payment status of each import cost (IMP-5) for the costs grid's chip and "Ödə" button. Pure.
 *
 * A cost of a draft shipment is not posted yet: what was paid for it are its advances
 * (pay_import_cost_advance). Once the shipment is confirmed (or the cost was added later) the
 * cost has a payable; payments relieve it (pay_import_payable).
 */
import type { CostLineDraft } from "./shipment";

export type CostPaymentStatus = "estimate" | "not_recorded" | "debt" | "partial" | "paid" | "nothing_due";

export interface CostPayableInfo {
  id: string;
  currencyCode: string;
  amountFc: number;
  amountAzn: number;
  paidFc: number;
  paidAzn: number;
  status: string;
}

export interface CostAdvanceInfo {
  amountFc: number;
  amountAzn: number;
  status: string;
}

export interface CostPaymentState {
  status: CostPaymentStatus;
  /** The cost's own currency (the payable's once posted). */
  currency: string;
  /** What the cost comes to with VAT, in its currency. */
  dueFc: number;
  paidFc: number;
  openFc: number;
  /** Open in AZN at the cost's own rate (posted: the payable's open booking value). */
  openAzn: number;
  /** "Pay" opens: the payable once posted; an advance in the draft. */
  mode: "payable" | "advance" | null;
  payableId: string | null;
}

const r2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
const EPS = 0.005;

/** The cost with VAT in its own currency (as its payable is booked on confirm). */
export function costDueFc(cost: Pick<CostLineDraft, "amount" | "currencyCode" | "rateToAzn" | "vatAmountAzn">): number {
  const rate = cost.currencyCode === "AZN" ? 1 : cost.rateToAzn || 1;
  return r2((r2(cost.amount * rate) + (cost.vatAmountAzn || 0)) / rate);
}

export function costPaymentState(input: {
  cost: Pick<CostLineDraft, "amount" | "currencyCode" | "rateToAzn" | "vatAmountAzn" | "isEstimate" | "paidNow">;
  /** The shipment is still a draft and this cost not posted. */
  draft: boolean;
  payable?: CostPayableInfo | null;
  advances?: readonly CostAdvanceInfo[];
}): CostPaymentState {
  const { cost } = input;
  if (!input.draft && input.payable) {
    const p = input.payable;
    const openFc = r2(p.amountFc - p.paidFc);
    const openAzn = r2(p.amountAzn - p.paidAzn);
    const status: CostPaymentStatus =
      p.status === "paid" || openFc <= EPS ? "paid" : p.paidFc > EPS ? "partial" : cost.isEstimate ? "estimate" : "debt";
    return { status, currency: p.currencyCode, dueFc: r2(p.amountFc), paidFc: r2(p.paidFc), openFc, openAzn, mode: status === "paid" ? null : "payable", payableId: p.id };
  }
  const dueFc = costDueFc(cost);
  const rate = cost.currencyCode === "AZN" ? 1 : cost.rateToAzn || 1;
  if (!input.draft) {
    // Posted without a payable: paid at once ("paid now"), or nothing to pay.
    return { status: cost.paidNow ? "paid" : dueFc > EPS ? "not_recorded" : "nothing_due", currency: cost.currencyCode, dueFc, paidFc: cost.paidNow ? dueFc : 0, openFc: 0, openAzn: 0, mode: null, payableId: null };
  }
  const paidFc = r2((input.advances ?? []).filter((a) => a.status !== "cancelled").reduce((s, a) => s + a.amountFc, 0));
  const openFc = r2(dueFc - paidFc);
  if (dueFc <= EPS) return { status: "nothing_due", currency: cost.currencyCode, dueFc, paidFc, openFc: 0, openAzn: 0, mode: null, payableId: null };
  const status: CostPaymentStatus = openFc <= EPS ? "paid" : paidFc > EPS ? "partial" : cost.isEstimate ? "estimate" : "not_recorded";
  return { status, currency: cost.currencyCode, dueFc, paidFc, openFc: Math.max(0, openFc), openAzn: r2(Math.max(0, openFc) * rate), mode: status === "paid" ? null : "advance", payableId: null };
}

/** Why "Pay" is not offered yet (the grid shows it as the button's tooltip), or null. */
export function payBlockedReason(input: { mode: CostPaymentState["mode"]; partnerId: string | null; saved: boolean; dirty: boolean }): "no_partner" | "save_first" | null {
  if (input.mode !== "advance") return null;
  if (!input.partnerId) return "no_partner";
  if (!input.saved || input.dirty) return "save_first";
  return null;
}
