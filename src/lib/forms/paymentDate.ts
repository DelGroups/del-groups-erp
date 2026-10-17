/** Today's date in the user's local time zone, as YYYY-MM-DD (the value of an <input type="date">). */
export function todayLocalDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** A payment date must be a real YYYY-MM-DD date, today or earlier. */
export function validatePaymentDate(
  value: string,
  today: string = todayLocalDate()
): "date_required" | "date_in_future" | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "date_required";
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return "date_required";
  }
  if (value > today) return "date_in_future";
  return null;
}
