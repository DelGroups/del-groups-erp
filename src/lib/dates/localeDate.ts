/**
 * Date formatting that does not depend on the browser's ICU data. Some browsers ship no Azerbaijani
 * date data and print "2026 M10 30, Fri" for month names; for `az` the month and weekday names come
 * from the tables below, everything else (numbers, time zones, other locales) stays with Intl.
 */

export const AZ_MONTHS_LONG = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avqust", "sentyabr", "oktyabr", "noyabr", "dekabr"];
export const AZ_MONTHS_SHORT = ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avq", "sen", "okt", "noy", "dek"];
export const AZ_WEEKDAYS_LONG = ["bazar", "bazar ertəsi", "çərşənbə axşamı", "çərşənbə", "cümə axşamı", "cümə", "şənbə"];
export const AZ_WEEKDAYS_SHORT = ["B.", "B.e.", "Ç.a.", "Ç.", "C.a.", "C.", "Ş."];
const AZ_WEEKDAYS_NARROW = ["B", "B", "Ç", "Ç", "C", "C", "Ş"];

type Options = Intl.DateTimeFormatOptions;
export type DateFormatter = Pick<Intl.DateTimeFormat, "format">;

const isAz = (locale: string | undefined) => !!locale && /^az(-|$)/i.test(locale);
const needsNames = (o: Options) => o.month === "short" || o.month === "long" || (!!o.weekday);

function azFormatter(options: Options): DateFormatter {
  const { weekday, month, ...rest } = options;
  // numbers (and the calendar day in the right time zone) from a locale every browser has
  const numeric = new Intl.DateTimeFormat("en-GB", { ...rest, month: "numeric", weekday: undefined });
  const dayOfWeek = new Intl.DateTimeFormat("en-US", { timeZone: options.timeZone, weekday: "short" });
  const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hasTime = options.hour !== undefined || options.minute !== undefined;
  const hasDate = options.day !== undefined || options.year !== undefined || month !== undefined || weekday !== undefined;
  return {
    format(date?: Date | number) {
      const d = date === undefined ? new Date() : new Date(date);
      const parts = numeric.formatToParts(d);
      const get = (type: string) => parts.find((p) => p.type === type)?.value;
      const out: string[] = [];
      if (hasDate) {
        const m = Number(get("month")) - 1;
        const monthText = month === "long" ? AZ_MONTHS_LONG[m] : month === "short" ? AZ_MONTHS_SHORT[m] : month ? get("month") : undefined;
        out.push([options.day !== undefined ? get("day") : undefined, monthText, options.year !== undefined ? get("year") : undefined].filter(Boolean).join(" "));
        if (weekday) {
          const w = WEEK.indexOf(dayOfWeek.format(d));
          const names = weekday === "long" ? AZ_WEEKDAYS_LONG : weekday === "short" ? AZ_WEEKDAYS_SHORT : AZ_WEEKDAYS_NARROW;
          out[0] = out[0] ? `${out[0]}, ${names[w]}` : names[w];
        }
      }
      if (hasTime) out.push(parts.filter((p) => ["hour", "minute", "second", "dayPeriod"].includes(p.type)).map((p) => p.value).join(":").replace(/:(AM|PM|am|pm)/, " $1"));
      return out.filter(Boolean).join(" ");
    },
  };
}

/** Drop-in for `new Intl.DateTimeFormat(locale, options)` (only `.format` is supported). */
export function dateFormat(locale: string | undefined, options: Options = {}): DateFormatter {
  if (isAz(locale) && needsNames(options)) return azFormatter(options);
  return new Intl.DateTimeFormat(locale, options);
}

export function formatDate(locale: string | undefined, date: Date | number | string, options: Options = {}): string {
  return dateFormat(locale, options).format(date instanceof Date || typeof date === "number" ? date : new Date(date));
}
