import { ACCOUNTING_GUARD_STATUSES, type AccountingGuardStatus } from "@/lib/features/accountingGuard";

/**
 * GUARD-2: the "Find duplicate or wrong names" drawer. Pure helpers that shape what guard_scan
 * stored (guard_findings rows of the product-name rules) into what the drawer lists, so they can
 * be tested without a browser or a database.
 *
 * The rules (supabase/migrations/20261120110000_accounting_guard_products.sql):
 *   F1 the exact same name        F2 similar names (one finding per cluster)
 *   F3 a name that looks like a code, or a code that looks like a name, stray spaces
 *   F5 the same code or barcode
 * F4 (missing unit, price, category) and the E rules belong to the Accounting Guard section.
 */

export const NAME_RULES = ["F1", "F2", "F3", "F5"] as const;
export type NameRule = (typeof NAME_RULES)[number];

/** What an admin still has to look at. */
export const NAME_OPEN_STATUSES: readonly AccountingGuardStatus[] = ["open", "acknowledged"];

/** `details.kind` of the name rules; each has a label in the i18n key accountingGuard.names.kinds.<kind>. */
export const NAME_KINDS = [
  "same_name",
  "similar_name",
  "name_spaces",
  "code_spaces",
  "code_is_name",
  "code_has_space",
  "name_is_a_code",
  "duplicate_code",
  "duplicate_barcode",
] as const;
export type NameKind = (typeof NAME_KINDS)[number];

export interface NameProductCard {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  category: string | null;
  stock: number | null;
  /** ISO timestamp of the product's last stock movement, null when it never moved. */
  lastMovement: string | null;
}

export interface NameFinding {
  id: string;
  rule: NameRule;
  kind: NameKind;
  severity: string;
  status: AccountingGuardStatus;
  note: string | null;
  products: NameProductCard[];
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const RULE_ORDER: Record<NameRule, number> = { F5: 0, F1: 1, F2: 2, F3: 3 };

export function isNameRule(value: unknown): value is NameRule {
  return typeof value === "string" && (NAME_RULES as readonly string[]).includes(value);
}

function isStatus(value: unknown): value is AccountingGuardStatus {
  return typeof value === "string" && (ACCOUNTING_GUARD_STATUSES as readonly string[]).includes(value);
}

function isKind(value: unknown): value is NameKind {
  return typeof value === "string" && (NAME_KINDS as readonly string[]).includes(value);
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** One product card of details.products; a card without an id is dropped. */
export function nameCardFromJson(raw: unknown): NameProductCard | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id === "") return null;
  return {
    id: r.id,
    code: typeof r.code === "string" ? r.code : "",
    name: typeof r.name === "string" ? r.name : "",
    unit: textOrNull(r.unit),
    category: textOrNull(r.category),
    stock: numberOrNull(r.stock),
    lastMovement: textOrNull(r.last_movement),
  };
}

/**
 * A guard_findings row → a drawer item. Rows of other rules, rows without products and rows
 * with an unknown status are dropped (null), so a newer database never breaks the drawer.
 */
export function nameFindingFromRow(row: Record<string, unknown>): NameFinding | null {
  if (typeof row.id !== "string" || !isNameRule(row.rule_code) || !isStatus(row.status)) return null;
  const details = row.details && typeof row.details === "object" ? (row.details as Record<string, unknown>) : {};
  const cards = Array.isArray(details.products) ? details.products.map(nameCardFromJson).filter((c): c is NameProductCard => c !== null) : [];
  if (cards.length === 0) return null;
  const kind = isKind(details.kind) ? details.kind : row.rule_code === "F2" ? "similar_name" : row.rule_code === "F1" ? "same_name" : null;
  if (!kind) return null;
  return {
    id: row.id,
    rule: row.rule_code,
    kind,
    severity: typeof row.severity === "string" ? row.severity : "medium",
    status: row.status,
    note: textOrNull(row.note),
    products: cards,
  };
}

/** Open findings first by severity, then duplicate codes, same names, similar names, then the rest; ties by the first product's name. */
export function sortNameFindings(list: readonly NameFinding[]): NameFinding[] {
  return [...list].sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
      RULE_ORDER[a.rule] - RULE_ORDER[b.rule] ||
      (a.products[0]?.name ?? "").localeCompare(b.products[0]?.name ?? "") ||
      a.id.localeCompare(b.id),
  );
}

/** Findings still to look at, sorted for the drawer. */
export function openNameFindings(rows: readonly Record<string, unknown>[]): NameFinding[] {
  return sortNameFindings(
    rows
      .map(nameFindingFromRow)
      .filter((f): f is NameFinding => f !== null && NAME_OPEN_STATUSES.includes(f.status)),
  );
}

/** The product card of the products list (`/products?highlight=<id>` opens it). */
export function productCardHref(productId: string): string {
  return `/products?highlight=${encodeURIComponent(productId)}`;
}

/** The finding in the Accounting Guard section (GUARD-3 builds the page). */
export function guardFindingHref(findingId: string): string {
  return `/finance/guard?tab=findings&finding=${encodeURIComponent(findingId)}`;
}

/** The reason a person types for "Not a duplicate": trimmed, collapsed, at least 3 characters. */
export const REASON_MIN_LENGTH = 3;
export const REASON_MAX_LENGTH = 500;

export function normalizeReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length < REASON_MIN_LENGTH) return null;
  return text.slice(0, REASON_MAX_LENGTH);
}
