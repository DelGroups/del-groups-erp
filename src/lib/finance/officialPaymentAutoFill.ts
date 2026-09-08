import type { OfficialVatBreakdown } from "@/lib/finance/vatEngine";

export interface TreasuryAccount {
  id: string;
  name: string;
  type?: string | null;
  is_vat_account?: boolean | null;
}

export interface PaymentRowLike {
  id: string;
  account_id?: string | null;
  amount?: number | null;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function isTreasuryVatAccount(
  accounts: TreasuryAccount[],
  accountId: string | null | undefined
): boolean {
  if (!accountId) return false;
  return Boolean(accounts.find((account) => account.id === accountId)?.is_vat_account);
}

export function sumVatPaymentAmounts(
  payments: PaymentRowLike[],
  accounts: TreasuryAccount[],
  excludePaymentId?: string
): number {
  return payments
    .filter((payment) => payment.id !== excludePaymentId)
    .filter((payment) => isTreasuryVatAccount(accounts, payment.account_id))
    .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
}

export function suggestOfficialPaymentAmount(
  accountId: string,
  accounts: TreasuryAccount[],
  amounts: OfficialVatBreakdown,
  payments: PaymentRowLike[],
  currentPaymentId: string
): number {
  const account = accounts.find((row) => row.id === accountId);
  if (!account) return 0;

  if (account.is_vat_account) {
    return amounts.vat_amount;
  }

  const vatAllocated = sumVatPaymentAmounts(payments, accounts, currentPaymentId);
  if (vatAllocated > 0) {
    return roundMoney(Math.max(0, amounts.grand_total - vatAllocated));
  }

  return roundMoney(Math.max(0, amounts.grand_total - amounts.vat_amount));
}

export function buildOfficialPaymentAccountPatch(
  accountId: string,
  paymentId: string,
  accounts: TreasuryAccount[],
  amounts: OfficialVatBreakdown,
  payments: PaymentRowLike[],
  isOfficial: boolean
): { account_id: string; method: string; amount?: number } {
  const account = accounts.find((row) => row.id === accountId);

  const patch: { account_id: string; method: string; amount?: number } = {
    account_id: accountId,
    method: account?.name ?? "",
  };

  if (isOfficial && accountId && account) {
    patch.amount = suggestOfficialPaymentAmount(
      accountId,
      accounts,
      amounts,
      payments,
      paymentId
    );
  }

  return patch;
}

export function formatTreasuryAccountLabel(
  account: TreasuryAccount,
  t: (key: string) => string
): string {
  const suffix = account.is_vat_account ? ` (${t("official.vatAccount")})` : "";
  const typeLabel = account.type ? ` (${account.type})` : "";
  return `${account.name}${suffix}${typeLabel}`;
}
