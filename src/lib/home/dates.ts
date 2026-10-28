/**
 * Dates of the home page (prompt 24b). The company works in Baku time unless its profile says
 * otherwise (the profile has no time zone yet): "today" is the Baku calendar day, also on a
 * server running in UTC. Pure.
 */

export const HOME_TIME_ZONE = "Asia/Baku";

/** YYYY-MM-DD of `date` in `timeZone`. */
export function isoDay(date: Date, timeZone: string = HOME_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** First and last day of a YYYY-MM month. */
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export type TrendRange = "30d" | "90d" | "12m";

/** The period and bucket of a trend range chip, ending today. */
export function rangeFor(range: TrendRange, today: string): { from: string; to: string; bucket: "day" | "week" | "month" } {
  const d = new Date(`${today}T12:00:00Z`);
  if (range === "12m") {
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 11, 1));
    return { from: start.toISOString().slice(0, 10), to: today, bucket: "month" };
  }
  const days = range === "90d" ? 89 : 29;
  const start = new Date(d.getTime() - days * 86400_000);
  return { from: start.toISOString().slice(0, 10), to: today, bucket: range === "90d" ? "week" : "day" };
}

/** Weeks of a month grid (Monday first): each cell is a YYYY-MM-DD or null outside the month. */
export function monthGrid(month: string): (string | null)[][] {
  const { to } = monthBounds(month);
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const offset = (first + 6) % 7;
  const total = Number(to.slice(8, 10));
  const cells: (string | null)[] = Array.from({ length: offset }, () => null);
  for (let day = 1; day <= total; day++) cells.push(`${month}-${String(day).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** Percent change from `previous` to `current` (one decimal), null when there is nothing to compare. */
export function deltaPercent(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}
