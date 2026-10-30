/**
 * Exchange differences of import payables (IMP-3), the same arithmetic as pay_import_payable and
 * confirm_import_shipment (supabase/migrations/20261030120000_imports_fx.sql), so the Pay dialog
 * shows what will be posted. Pure.
 *
 * A payable is booked in AZN at its booking rate. A payment of x units of the currency at the
 * payment-date rate costs round(x × rate) AZN and relieves the payable by its share of the open
 * AZN balance (all of it when x settles the rest). The difference is an exchange difference:
 * positive = loss (6260), negative = gain (4960).
 */
import { round2, toCents } from "./landedCost";

export interface FxPaymentInput {
  currencyCode: string;
  /** Open balance in the payable's currency and in AZN at the booking value. */
  openFc: number;
  openAzn: number;
  /** For AZN payables the AZN paid; otherwise units of the currency. */
  amountFc: number;
  /** AZN per unit on the payment date (1 for AZN). */
  rate: number;
}

export interface FxPayment {
  /** AZN leaving the accounts. */
  paidAzn: number;
  /** Booking value relieved on 2100. */
  settledAzn: number;
  /** paidAzn − settledAzn: > 0 loss (6260), < 0 gain (4960). */
  differenceAzn: number;
  remainingFc: number;
  remainingAzn: number;
  /** More than the open balance (in the currency). */
  overpay: boolean;
}

const EPS = 0.005;

export function fxPayment(input: FxPaymentInput): FxPayment {
  const azn = input.currencyCode === "AZN";
  const fc = round2(Math.max(0, input.amountFc));
  const rate = azn ? 1 : Math.max(0, input.rate);
  const paidAzn = azn ? fc : round2(fc * rate);
  const overpay = azn ? fc > input.openAzn + EPS : fc > input.openFc + EPS;
  let settledAzn: number;
  if (azn) settledAzn = fc;
  else if (fc >= input.openFc - EPS) settledAzn = round2(input.openAzn);
  else settledAzn = input.openFc > 0 ? round2((input.openAzn * fc) / input.openFc) : 0;
  return {
    paidAzn,
    settledAzn,
    differenceAzn: (toCents(paidAzn) - toCents(settledAzn)) / 100,
    remainingFc: azn ? round2(input.openAzn - fc) : round2(input.openFc - fc),
    remainingAzn: round2(input.openAzn - settledAzn),
    overpay,
  };
}

export interface Prepayment {
  amountFc: number;
  amountAzn: number;
}

/**
 * AZN per unit of the shipment currency for the goods on confirmation: the prepaid part at the
 * prepayments' own rate, the rest at the invoice rate (IAS 21 / IFRIC 22), 6 decimals. Null
 * without prepayments (the invoice rate applies) or when they exceed the goods.
 */
export function effectiveGoodsRate(goodsFc: number, invoiceRate: number, prepayments: readonly Prepayment[]): number | null {
  const fc = round2(goodsFc);
  const prepFc = round2(prepayments.reduce((s, p) => s + p.amountFc, 0));
  const prepAzn = round2(prepayments.reduce((s, p) => s + p.amountAzn, 0));
  if (prepFc <= 0 || fc <= 0 || prepFc > fc + EPS) return null;
  return Math.round(((prepAzn + (fc - prepFc) * invoiceRate) / fc) * 1e6) / 1e6;
}
