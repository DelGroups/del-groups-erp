/**
 * The one date and number formatting module (docs/ui-standard.md). Nothing here depends on the
 * browser's ICU data: some browsers ship no Azerbaijani data and print "2026 M10 30, Fri" (or
 * "2026 M10 17 13:00" for a numeric date), so for `az` every date is built from parts of a
 * locale every browser has, with month and weekday names from the tables below.
 *
 * - Grids, cells and inputs: always numeric, dd.mm.yyyy and dd.mm.yyyy HH:mm, in every language
 *   (formatGridDate / formatGridDateTime).
 * - Month names only in long headings (formatLongDate, or dateFormat with month "long").
 * - Money, quantities and plain numbers: formatFigure / formatMoney / formatQuantity, fixed
 *   separators per language so server and browser print the same text.
 *
 * Calling toLocaleString / toLocaleDateString / Intl.DateTimeFormat anywhere else fails lint
 * (eslint.config.mjs, scripts/ui-guard-allowlist.json).
 */

export const AZ_MONTHS_LONG = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avqust", "sentyabr", "oktyabr", "noyabr", "dekabr"];
export const AZ_MONTHS_SHORT = ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avq", "sen", "okt", "noy", "dek"];
export const AZ_WEEKDAYS_LONG = ["bazar", "bazar ertəsi", "çərşənbə axşamı", "çərşənbə", "cümə axşamı", "cümə", "şənbə"];
export const AZ_WEEKDAYS_SHORT = ["B.", "B.e.", "Ç.a.", "Ç.", "C.a.", "C.", "Ş."];
const AZ_WEEKDAYS_NARROW = ["B", "B", "Ç", "Ç", "C", "C", "Ş"];

type Options = Intl.DateTimeFormatOptions;
export type DateFormatter = Pick<Intl.DateTimeFormat, "format">;
/** What the helpers accept: a Date, epoch ms, an ISO string ("2026-10-17" or a timestamp) or nothing. */
export type DateValue = Date | number | string | null | undefined;

const isAz = (locale: string | undefined) => !!locale && /^az(-|$)/i.test(locale);
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** dateStyle / timeStyle written out as fields, so `az` never reaches the browser's ICU data. */
function expandStyles(options: Options): Options {
  const { dateStyle, timeStyle, ...rest } = options;
  if (!dateStyle && !timeStyle) return options;
  const out: Options = { ...rest };
  if (dateStyle === "full") Object.assign(out, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  else if (dateStyle === "long") Object.assign(out, { day: "numeric", month: "long", year: "numeric" });
  else if (dateStyle) Object.assign(out, { day: "2-digit", month: "2-digit", year: "numeric" });
  if (timeStyle) Object.assign(out, { hour: "2-digit", minute: "2-digit", ...(timeStyle === "short" ? {} : { second: "2-digit" }) });
  return out;
}

function azFormatter(input: Options): DateFormatter {
  const options = expandStyles(input);
  const { weekday, month } = options;
  // numbers (and the calendar day in the right time zone) from a locale every browser has
  const numeric = new Intl.DateTimeFormat("en-GB", {
    timeZone: options.timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const dayOfWeek = new Intl.DateTimeFormat("en-US", { timeZone: options.timeZone, weekday: "short" });
  const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hasTime = options.hour !== undefined || options.minute !== undefined;
  const hasDate = options.day !== undefined || options.year !== undefined || month !== undefined || weekday !== undefined;
  const named = month === "long" || month === "short";
  return {
    format(date?: Date | number) {
      const d = date === undefined ? new Date() : new Date(date);
      const parts = numeric.formatToParts(d);
      const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
      const out: string[] = [];
      if (hasDate) {
        const m = Number(get("month")) - 1;
        const day = options.day !== undefined ? (named && options.day === "numeric" ? String(Number(get("day"))) : get("day")) : undefined;
        const year = options.year !== undefined ? get("year") : undefined;
        let text: string;
        if (named) text = [day, month === "long" ? AZ_MONTHS_LONG[m] : AZ_MONTHS_SHORT[m], year].filter(Boolean).join(" ");
        else text = [day, month ? get("month") : undefined, year].filter(Boolean).join(".");
        if (weekday) {
          const w = WEEK.indexOf(dayOfWeek.format(d));
          const names = weekday === "long" ? AZ_WEEKDAYS_LONG : weekday === "short" ? AZ_WEEKDAYS_SHORT : AZ_WEEKDAYS_NARROW;
          text = text ? `${text}, ${names[w]}` : names[w];
        }
        out.push(text);
      }
      if (hasTime) out.push([get("hour"), get("minute"), options.second !== undefined ? get("second") : undefined].filter(Boolean).join(":"));
      return out.filter(Boolean).join(" ");
    },
  };
}

/** Drop-in for `new Intl.DateTimeFormat(locale, options)` (only `.format` is supported). */
export function dateFormat(locale: string | undefined, options: Options = {}): DateFormatter {
  if (isAz(locale)) return azFormatter(options);
  return new Intl.DateTimeFormat(locale, options);
}

/** A Date for the value, or null. A bare "yyyy-mm-dd" is that calendar day at local midnight. */
export function toDateValue(value: DateValue): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const m = DATE_ONLY.exec(value);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(locale: string | undefined, date: Date | number | string, options: Options = {}): string {
  return dateFormat(locale, options).format(date instanceof Date || typeof date === "number" ? date : toDateValue(date) ?? new Date(NaN));
}

export interface GridOptions {
  /** IANA zone the day and time are shown in; the browser's zone when missing. */
  timeZone?: string;
  /** Text for an empty or invalid value. */
  empty?: string;
}

const gridParts = new Map<string, Intl.DateTimeFormat>();
function numericParts(d: Date, timeZone: string | undefined) {
  const key = timeZone ?? "";
  let f = gridParts.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    gridParts.set(key, f);
  }
  const parts = f.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { day: get("day"), month: get("month"), year: get("year"), hour: get("hour"), minute: get("minute") };
}

/** dd.mm.yyyy in every language (grids, cells, inputs). A bare "yyyy-mm-dd" is never shifted by time zone. */
export function formatGridDate(value: DateValue, options: GridOptions = {}): string {
  if (typeof value === "string") {
    const m = DATE_ONLY.exec(value);
    if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  }
  const d = toDateValue(value);
  if (!d) return options.empty ?? "—";
  const p = numericParts(d, options.timeZone);
  return `${p.day}.${p.month}.${p.year}`;
}

/** dd.mm.yyyy HH:mm (24 hours) in every language. */
export function formatGridDateTime(value: DateValue, options: GridOptions = {}): string {
  const d = toDateValue(value);
  if (!d) return options.empty ?? "—";
  const p = numericParts(d, options.timeZone);
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
}

/** HH:mm (24 hours). */
export function formatTime(value: DateValue, options: GridOptions = {}): string {
  const d = toDateValue(value);
  if (!d) return options.empty ?? "—";
  const p = numericParts(d, options.timeZone);
  return `${p.hour}:${p.minute}`;
}

/** "17 oktyabr 2026" / "17 октября 2026 г." / "17 October 2026": long headings only, never grids. */
export function formatLongDate(locale: string | undefined, value: DateValue, options: GridOptions = {}): string {
  const d = toDateValue(value);
  if (!d) return options.empty ?? "—";
  return dateFormat(locale, { timeZone: options.timeZone, day: "numeric", month: "long", year: "numeric" }).format(d);
}

// ── Numbers ──────────────────────────────────────────────────────────────────

/**
 * Separators per language: en 1,234.5 · az 1.234,5 · ru 1 234,5 (no-break space). Written out
 * instead of Intl.NumberFormat because Node's and the browser's ICU data differ for az, which
 * would make server-rendered figures disagree with the browser's (hydration mismatch).
 */
const SEPARATORS: Record<string, { group: string; decimal: string }> = {
  en: { group: ",", decimal: "." },
  az: { group: ".", decimal: "," },
  ru: { group: " ", decimal: "," },
};

const separators = (locale: string | undefined) => SEPARATORS[(locale ?? "en").slice(0, 2).toLowerCase()] ?? SEPARATORS.en;

/** Thousands separators per language, fixed decimals; the same on server and client. */
export function formatFigure(value: number, decimals: number, locale = "en"): string {
  const sep = separators(locale);
  const fixed = Math.abs(value).toFixed(Math.max(0, decimals));
  const [int, frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, sep.group);
  const sign = value < 0 && Number(fixed) !== 0 ? "-" : "";
  return `${sign}${grouped}${frac ? sep.decimal + frac : ""}`;
}

export interface MoneyOptions {
  decimals?: number;
  /** Code after the amount ("AZN"); null for the bare figure. */
  currency?: string | null;
  empty?: string;
}

/** 1.234,50 AZN: two decimals, the currency code after a no-break space. */
export function formatMoney(value: number | null | undefined, locale: string | undefined, options: MoneyOptions = {}): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return options.empty ?? "—";
  const figure = formatFigure(Number(value), options.decimals ?? 2, locale);
  const currency = options.currency === undefined ? "AZN" : options.currency;
  return currency ? `${figure} ${currency}` : figure;
}

/** Quantities: up to `maxDecimals` decimals, trailing zeros dropped (12 · 12,5 · 0,125). */
export function formatQuantity(value: number | null | undefined, locale: string | undefined, maxDecimals = 3, empty = "—"): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return empty;
  const n = Number(value);
  const rounded = Number(n.toFixed(maxDecimals));
  const text = String(Math.abs(rounded));
  const decimals = text.includes("e") ? maxDecimals : Math.min(maxDecimals, text.includes(".") ? text.length - text.indexOf(".") - 1 : 0);
  return formatFigure(rounded, decimals, locale);
}
