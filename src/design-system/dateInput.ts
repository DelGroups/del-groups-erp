/**
 * Logic of DateField and DateTimeField (UI-1, docs/ui-standard.md), pure so `node --test` covers
 * it. People type dd.mm.yyyy (and HH:mm); the value the form keeps is ISO: "yyyy-mm-dd" for a
 * date, "yyyy-mm-ddTHH:mm" (local time, like <input type="datetime-local">) for a date and time.
 */

const pad2 = (n: number) => String(n).padStart(2, "0");

/** The calendar day exists (31.02 does not; 29.02 only in leap years). */
export function isValidDay(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(year, month, 0).getDate();
}

/**
 * Mask while typing: digits get dots after the day and the month ("1710" → "17.10",
 * "17102026" → "17.10.2026"). Typed separators (".", "/", "-", ",", space) are kept as dots,
 * so "1.2.2026" stays as typed. At most dd.mm.yyyy.
 */
export function maskDateText(raw: string): string {
  const text = raw.replace(/[/\-, ]/g, ".");
  const parts = text.split(".");
  // Dots where the mask put them (after two digits): keep masking the digits, so typing on
  // after "17.10" gives "17.10.2", not a lost digit.
  const masked = parts.slice(0, -1).every((p) => p.replace(/\D/g, "").length === 2);
  if (masked) {
    const digits = text.replace(/\D/g, "").slice(0, 8);
    let out = digits.length <= 2 ? digits : digits.length <= 4 ? `${digits.slice(0, 2)}.${digits.slice(2)}` : `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
    if (text.endsWith(".") && (out.length === 2 || out.length === 5)) out += ".";
    return out;
  }
  const [d = "", m = "", y = ""] = parts.map((p) => p.replace(/\D/g, ""));
  const dots = Math.min(2, parts.length - 1);
  return [d.slice(0, 2), m.slice(0, 2), y.slice(0, 4)].slice(0, dots + 1).join(".");
}

/** "17.10.2026" (also "17.10.26", "1.2.2026") → "2026-10-17"; null while incomplete or invalid. */
export function parseDateText(text: string): string | null {
  const m = /^\s*(\d{1,2})[./\-](\d{1,2})[./\-](\d{2}|\d{4})\s*$/.exec(text);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return isValidDay(year, month, day) ? `${year}-${pad2(month)}-${pad2(day)}` : null;
}

/** "2026-10-17" (or a timestamp starting with it) → "17.10.2026"; "" for nothing. */
export function isoToDateText(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
}

/** Mask for "dd.mm.yyyy HH:mm": the date part as above, then up to four time digits. */
export function maskDateTimeText(raw: string): string {
  const [datePart = "", ...rest] = raw.trim().split(/\s+/);
  const onlyDigits = !rest.length && /^\d+$/.test(datePart);
  if (onlyDigits && datePart.length > 8) {
    const digits = datePart.slice(0, 12);
    return `${maskDateText(digits.slice(0, 8))} ${maskTime(digits.slice(8))}`;
  }
  const date = maskDateText(datePart);
  if (!rest.length) return /\s$/.test(raw) && date.length === 10 ? `${date} ` : date;
  return `${date} ${maskTime(rest.join(""))}`;
}

function maskTime(raw: string): string {
  if (raw.includes(":")) {
    const [h = "", mm = ""] = raw.split(":").map((p) => p.replace(/\D/g, ""));
    return `${h.slice(0, 2)}:${mm.slice(0, 2)}`;
  }
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

/** "17.10.2026 13:05" → "2026-10-17T13:05"; a date without time → 00:00; null if invalid. */
export function parseDateTimeText(text: string): string | null {
  const [datePart = "", timePart = ""] = text.trim().split(/\s+/);
  const date = parseDateText(datePart);
  if (!date) return null;
  if (!timePart) return `${date}T00:00`;
  const t = /^(\d{1,2}):(\d{2})$/.exec(timePart);
  if (!t || Number(t[1]) > 23 || Number(t[2]) > 59) return null;
  return `${date}T${pad2(Number(t[1]))}:${t[2]}`;
}

/** "2026-10-17T13:05…" → "17.10.2026 13:05". */
export function isoToDateTimeText(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso ?? "");
  if (m) return `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}`;
  const date = isoToDateText(iso);
  return date ? `${date} 00:00` : "";
}

export interface CalendarDay {
  iso: string;
  day: number;
  inMonth: boolean;
}

/** "yyyy-mm-dd" of a local Date. */
export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Six weeks of seven days around the month (month 0–11), weeks starting on Monday by default. */
export function monthMatrix(year: number, month: number, weekStartsOn = 1): CalendarDay[][] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() - weekStartsOn + 7) % 7;
  const start = new Date(year, month, 1 - offset);
  const weeks: CalendarDay[][] = [];
  for (let w = 0; w < 6; w++) {
    const week: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + i);
      week.push({ iso: toIsoDate(d), day: d.getDate(), inMonth: d.getMonth() === month });
    }
    weeks.push(week);
  }
  return weeks;
}

/** The day `days` away from `iso` ("yyyy-mm-dd"). */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return toIsoDate(new Date(y, m - 1, d + days));
}

/** The same day `months` away, clamped to the month's last day (31.01 + 1 → 28/29.02). */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(y, m - 1 + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return toIsoDate(new Date(target.getFullYear(), target.getMonth(), Math.min(d, last)));
}
