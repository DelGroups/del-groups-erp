/** Display value for controlled numeric inputs — empty when unset or zero. */
export function numberToFieldValue(
  value: number | string | null | undefined,
  options?: { treatZeroAsEmpty?: boolean }
): string {
  const treatZeroAsEmpty = options?.treatZeroAsEmpty ?? true;

  if (value === null || value === undefined) return "";

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return "";
    if (trimmed === "-" || trimmed.endsWith(".")) return trimmed;
    const parsed = parseFloat(trimmed);
    if (!Number.isFinite(parsed)) return trimmed;
    if (treatZeroAsEmpty && parsed === 0) return "";
    return trimmed;
  }

  if (!Number.isFinite(value)) return "";
  if (treatZeroAsEmpty && value === 0) return "";
  return Number.isInteger(value) ? String(value) : String(value);
}

/** Parse a form field string to a number, using fallback when empty or invalid. */
export function parseFieldNumber(value: string, fallback = 0): number {
  const trimmed = value.trim();
  if (trimmed === "") return fallback;
  const parsed = parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Parse a form field string to a number or null when empty. */
export function parseFieldOptionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Format a stored price for an input — hides zero so placeholders can show. */
export function priceToFieldValue(price: number | null | undefined): string {
  if (price === null || price === undefined || price === 0) return "";
  return Number.isInteger(price) ? String(price) : price.toFixed(2);
}
