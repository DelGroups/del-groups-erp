/** Small helpers shared by the billing editors (client and server). */
import { formatMoney } from "../format.ts";
import type { Locale } from "../i18n/messages.ts";

/** Fills {name} placeholders. */
export function fill(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => (vars[name] !== undefined ? String(vars[name]) : `{${name}}`));
}

export function money(locale: Locale, cents: number, currency: string): string {
  return formatMoney(locale, cents / 100, currency);
}
