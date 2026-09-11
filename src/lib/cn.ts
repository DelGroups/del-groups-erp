export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export const NUMERIC_CLASS = "font-mono tabular-nums text-right";
