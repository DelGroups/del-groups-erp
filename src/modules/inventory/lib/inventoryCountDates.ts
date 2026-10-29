/**
 * Date rules of an inventory count (fix F2). The database enforces the same rules
 * (trg_inventory_count_date_rules); these keep the form and the server actions in step.
 *
 *   - a count is never dated in the future;
 *   - a past date (a backdated count) is for admins only;
 *   - "today" is Baku's date, not the browser's or the server's.
 */

export const COUNT_TIME_ZONE = "Asia/Baku";

export type CountDateProblem = "invalid" | "future" | "past_admin_only";

/** YYYY-MM-DD of `now` in Baku. */
export function countToday(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: COUNT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** True when the count is dated before today (book quantities then come from the movement log). */
export function isBackdated(countDate: string, today: string): boolean {
  return isIsoDate(countDate) && countDate < today;
}

/** Why this user may not use this date, or null when it is fine. */
export function checkCountDate(
  countDate: string,
  { today, isAdmin }: { today: string; isAdmin: boolean }
): CountDateProblem | null {
  if (!isIsoDate(countDate)) return "invalid";
  if (countDate > today) return "future";
  if (countDate < today && !isAdmin) return "past_admin_only";
  return null;
}
