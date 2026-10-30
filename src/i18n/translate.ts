import type { Messages } from "@/i18n/messages";
import { formatGridDate, formatGridDateTime } from "@/lib/dates/localeDate";

export function translate(
  messages: Messages,
  key: string,
  params?: Record<string, string | number>
): string {
  const parts = key.split(".");
  let current: unknown = messages;

  for (const part of parts) {
    if (current == null || typeof current !== "object") {
      return key;
    }
    current = (current as Record<string, unknown>)[part];
  }

  if (typeof current !== "string") {
    return key;
  }

  if (!params) {
    return current;
  }

  return current.replace(/\{(\w+)\}/g, (_, name: string) =>
    params[name] !== undefined ? String(params[name]) : `{${name}}`
  );
}

/** dd.mm.yyyy HH:mm in every language (src/lib/dates/localeDate.ts); "-" when empty. */
export function formatDateTime(
  _locale: string,
  value: string | null | undefined
): string {
  return formatGridDateTime(value, { empty: "-" });
}

/** dd.mm.yyyy in every language; "-" when empty. */
export function formatDate(
  _locale: string,
  value: string | null | undefined
): string {
  return formatGridDate(value, { empty: "-" });
}
