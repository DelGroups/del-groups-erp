export type VatMode = "none" | "exclusive" | "inclusive";

export const DEFAULT_VAT_RATE = 18;

export interface OfficialVatBreakdown {
  subtotal_amount: number;
  vat_rate: number;
  vat_amount: number;
  grand_total: number;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateOfficialVat(
  itemsNetTotal: number,
  vatMode: VatMode,
  vatRate = DEFAULT_VAT_RATE
): OfficialVatBreakdown {
  const net = Math.max(0, Number(itemsNetTotal) || 0);
  const rate = Number(vatRate) || DEFAULT_VAT_RATE;

  if (vatMode === "none" || net <= 0) {
    return {
      subtotal_amount: roundMoney(net),
      vat_rate: vatMode === "none" ? 0 : rate,
      vat_amount: 0,
      grand_total: roundMoney(net),
    };
  }

  const rateFraction = rate / 100;

  if (vatMode === "exclusive") {
    const vatAmount = roundMoney(net * rateFraction);
    return {
      subtotal_amount: roundMoney(net),
      vat_rate: rate,
      vat_amount: vatAmount,
      grand_total: roundMoney(net + vatAmount),
    };
  }

  const grandTotal = roundMoney(net);
  const subtotalAmount = roundMoney(grandTotal / (1 + rateFraction));
  const vatAmount = roundMoney(grandTotal - subtotalAmount);
  return {
    subtotal_amount: subtotalAmount,
    vat_rate: rate,
    vat_amount: vatAmount,
    grand_total: grandTotal,
  };
}

export function calcOfficialTransactionTotals(
  itemsNetTotal: number,
  options: {
    isOfficial: boolean;
    vatMode: VatMode;
    vatRate?: number;
    deliveryCost?: number;
    additionalExpensesTotal?: number;
  }
): OfficialVatBreakdown {
  const delivery = Number(options.deliveryCost) || 0;
  const addExp = Number(options.additionalExpensesTotal) || 0;

  if (!options.isOfficial) {
    const grand = roundMoney(itemsNetTotal + delivery + addExp);
    return {
      subtotal_amount: roundMoney(itemsNetTotal),
      vat_rate: 0,
      vat_amount: 0,
      grand_total: grand,
    };
  }

  const vat = calculateOfficialVat(itemsNetTotal, options.vatMode, options.vatRate);
  return {
    ...vat,
    grand_total: roundMoney(vat.grand_total + delivery + addExp),
  };
}

export function allocateOfficialPaymentSplit(
  paymentAmount: number,
  documentSubtotalAmount: number,
  documentVatAmount: number,
  documentGrandTotal: number
): { baseAmount: number; vatAmount: number } {
  const amount = Math.max(0, Number(paymentAmount) || 0);
  const grand = Math.max(0, Number(documentGrandTotal) || 0);
  const subtotal = Math.max(0, Number(documentSubtotalAmount) || 0);
  const vat = Math.max(0, Number(documentVatAmount) || 0);

  if (amount <= 0 || grand <= 0 || vat <= 0) {
    return { baseAmount: roundMoney(amount), vatAmount: 0 };
  }

  const vatShare = vat / grand;
  const vatPortion = roundMoney(amount * vatShare);
  const basePortion = roundMoney(amount - vatPortion);
  return { baseAmount: basePortion, vatAmount: vatPortion };
}
