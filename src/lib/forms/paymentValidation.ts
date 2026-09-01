/** Exact client/server message when cash/bank account is missing. */
export const PAYMENT_ACCOUNT_REQUIRED_MESSAGE =
  "Zəhmət olmasa kassa və ya bank hesabını seçin";

export function assertPaymentAccountId(
  accountId: string | null | undefined
): string | null {
  const id = accountId?.trim();
  if (!id) return PAYMENT_ACCOUNT_REQUIRED_MESSAGE;
  return null;
}
