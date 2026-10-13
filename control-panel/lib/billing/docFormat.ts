/** Dates and amounts as invoices and billing emails print them (the same in every language). */

/** 2026-11-01 → 01.11.2026 (the usual form in Azerbaijan and Russia, unambiguous in English). */
export function formatDocDate(value: string | null | undefined): string {
  if (!value) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
}

/** 1234.5 → "1 234.50 AZN" with plain spaces. */
export function formatDocMoney(amount: number, currency: string): string {
  const [int, frac] = Math.abs(amount).toFixed(2).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${amount < 0 ? "−" : ""}${grouped}.${frac} ${currency}`;
}
