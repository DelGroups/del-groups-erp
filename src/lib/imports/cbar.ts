/**
 * Official CBAR exchange rates (Imports module, IMP-1). Pure parsing of
 * https://www.cbar.az/currencies/DD.MM.YYYY.xml; the server action fetches and stores them.
 *
 * The bulletin quotes some currencies per 100 units (RUB: Nominal 100), so the rate per unit is
 * Value / Nominal. For a date without a bulletin (a weekend, the future) CBAR answers with the
 * latest one under its own date: `date` is the bulletin's date, which the caller shows.
 */

export const IMPORT_CURRENCIES = ["AZN", "USD", "EUR", "TRY", "CNY", "RUB"] as const;
export type ImportCurrency = (typeof IMPORT_CURRENCIES)[number];

export function isImportCurrency(value: unknown): value is ImportCurrency {
  return typeof value === "string" && (IMPORT_CURRENCIES as readonly string[]).includes(value);
}

/** yyyy-mm-dd → DD.MM.YYYY (CBAR's file name); null for an invalid date. */
export function cbarDateParam(isoDate: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

export function cbarUrl(isoDate: string): string | null {
  const param = cbarDateParam(isoDate);
  return param ? `https://www.cbar.az/currencies/${param}.xml` : null;
}

export interface CbarBulletin {
  /** yyyy-mm-dd of the bulletin. */
  date: string;
  /** AZN per one unit, for the currencies CBAR lists. */
  rates: Partial<Record<string, number>>;
}

/** Parses a CBAR bulletin; null when the text is not one (an error page, an empty answer). */
export function parseCbarXml(xml: string): CbarBulletin | null {
  if (typeof xml !== "string") return null;
  const head = /<ValCurs\b[^>]*\bDate="(\d{2})\.(\d{2})\.(\d{4})"/.exec(xml);
  if (!head) return null;
  const date = `${head[3]}-${head[2]}-${head[1]}`;
  const rates: Record<string, number> = {};
  const valute = /<Valute\s+Code="([A-Z]{3})"\s*>([\s\S]*?)<\/Valute>/g;
  for (const m of xml.matchAll(valute)) {
    const nominal = Number((/<Nominal>\s*([\d.,]+)/.exec(m[2])?.[1] ?? "").replace(",", "."));
    const value = Number((/<Value>\s*([\d.,]+)\s*<\/Value>/.exec(m[2])?.[1] ?? "").replace(",", "."));
    if (!(nominal > 0) || !(value > 0)) continue;
    rates[m[1]] = Math.round((value / nominal) * 1e6) / 1e6;
  }
  return Object.keys(rates).length ? { date, rates } : null;
}
