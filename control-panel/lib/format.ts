import type { Locale } from "@/lib/i18n/messages";

const INTL_LOCALE: Record<Locale, string> = { az: "az-Latn-AZ", en: "en-GB", ru: "ru-RU" };

export function formatDate(locale: Locale, value: string | null | undefined, withTime = false): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
  }).format(date);
}

export function formatMoney(locale: Locale, amount: number | string | null | undefined, currency: string): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  return new Intl.NumberFormat(INTL_LOCALE[locale], { style: "currency", currency }).format(Number(amount));
}
