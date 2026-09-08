import { allocateOfficialPaymentSplit } from "@/lib/finance/vatEngine";

export interface InvoicePaymentRow {
  account_id?: string | null;
  amount?: number | null;
}

export interface InvoiceDebtInput {
  isOfficial?: boolean;
  subtotalAmount?: number | null;
  vatAmount?: number | null;
  grandTotal?: number | null;
  totalAmount?: number | null;
  paidAmount?: number | null;
  remainingBalance?: number | null;
  payments?: InvoicePaymentRow[];
}

export interface InvoiceDebtBreakdown {
  paidBase: number;
  paidVat: number;
  remainingBase: number;
  remainingVat: number;
  totalRemaining: number;
  showSplit: boolean;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toAmount(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function classifyPaymentAmount(
  amount: number,
  accountId: string | null | undefined,
  vatAccountIds: ReadonlySet<string>,
  subtotalAmount: number,
  vatAmount: number,
  grandTotal: number
): { baseAmount: number; vatAmount: number } {
  const normalizedAccountId = accountId?.trim();
  if (normalizedAccountId && vatAccountIds.has(normalizedAccountId)) {
    return { baseAmount: 0, vatAmount: roundMoney(amount) };
  }
  if (normalizedAccountId) {
    return { baseAmount: roundMoney(amount), vatAmount: 0 };
  }
  return allocateOfficialPaymentSplit(amount, subtotalAmount, vatAmount, grandTotal);
}

export function computeInvoiceDebtBreakdown(
  input: InvoiceDebtInput,
  vatAccountIds: ReadonlySet<string> = new Set()
): InvoiceDebtBreakdown {
  const grandTotal = toAmount(input.grandTotal ?? input.totalAmount);
  const vatAmount = toAmount(input.vatAmount);
  const subtotalAmount = toAmount(
    input.subtotalAmount != null ? input.subtotalAmount : Math.max(0, grandTotal - vatAmount)
  );
  const totalPaid = toAmount(input.paidAmount);
  const storedRemaining = toAmount(input.remainingBalance);
  const totalRemaining =
    storedRemaining > 0 ? storedRemaining : roundMoney(Math.max(0, grandTotal - totalPaid));
  const showSplit = input.isOfficial === true && vatAmount > 0;

  if (!showSplit) {
    return {
      paidBase: totalPaid,
      paidVat: 0,
      remainingBase: totalRemaining,
      remainingVat: 0,
      totalRemaining,
      showSplit: false,
    };
  }

  let paidBase = 0;
  let paidVat = 0;
  const payments = input.payments ?? [];

  if (payments.length > 0) {
    for (const payment of payments) {
      const amount = toAmount(payment.amount);
      if (amount <= 0) continue;
      const split = classifyPaymentAmount(
        amount,
        payment.account_id,
        vatAccountIds,
        subtotalAmount,
        vatAmount,
        grandTotal
      );
      paidBase += split.baseAmount;
      paidVat += split.vatAmount;
    }
  } else if (totalPaid > 0) {
    const split = allocateOfficialPaymentSplit(
      totalPaid,
      subtotalAmount,
      vatAmount,
      grandTotal
    );
    paidBase = split.baseAmount;
    paidVat = split.vatAmount;
  }

  paidBase = roundMoney(paidBase);
  paidVat = roundMoney(paidVat);

  return {
    paidBase,
    paidVat,
    remainingBase: roundMoney(Math.max(0, subtotalAmount - paidBase)),
    remainingVat: roundMoney(Math.max(0, vatAmount - paidVat)),
    totalRemaining,
    showSplit: true,
  };
}
