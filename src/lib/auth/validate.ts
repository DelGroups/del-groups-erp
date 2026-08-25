/** Shared input validation for API routes and server actions. */

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function clampString(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}
