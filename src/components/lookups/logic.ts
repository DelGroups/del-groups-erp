/**
 * Pure helpers of the standard lookup field (UI-2 lookups, docs/ui-standard.md "Lookups"):
 * search text → PostgREST filter, recent items first, quick-create prefill, merging a new record
 * into a form's local list. No React and no Supabase here, so tests run them under plain Node.
 */

/** How many rows one search returns. */
export const LOOKUP_LIMIT = 20;
/** How many recently picked ids are kept per entity (and shown first). */
export const RECENT_LIMIT = 5;

/**
 * One word of the search, safe inside a PostgREST `or=(…)` ilike filter: characters that the
 * filter grammar or LIKE treat specially (, ( ) * % _ \ ") are dropped, spaces collapse.
 */
export function sanitizeSearchTerm(raw: string): string {
  return raw
    .replace(/[,()*%_\\"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/**
 * The `or` filter for one search: every column `ilike` the whole term. Empty when there is
 * nothing to search (then the query lists the first rows by its order).
 */
export function buildSearchFilter(query: string, columns: readonly string[]): string {
  const term = sanitizeSearchTerm(query);
  if (!term || columns.length === 0) return "";
  return columns.map((column) => `${column}.ilike.*${term}*`).join(",");
}

export interface LookupRow {
  id: string;
}

/**
 * Recent picks first (in recent order), then the rest in the order the database returned.
 * Recent ids that are not in the result are skipped: the search did not match them.
 */
export function orderWithRecent<T extends LookupRow>(rows: readonly T[], recentIds: readonly string[]): T[] {
  if (recentIds.length === 0) return [...rows];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const first: T[] = [];
  for (const id of recentIds) {
    const row = byId.get(id);
    if (row) {
      first.push(row);
      byId.delete(id);
    }
  }
  return [...first, ...rows.filter((row) => byId.has(row.id))];
}

/** The id list after picking `id`: it moves to the front, the list stays at most `limit` long. */
export function pushRecent(recentIds: readonly string[], id: string, limit = RECENT_LIMIT): string[] {
  if (!id) return [...recentIds];
  return [id, ...recentIds.filter((existing) => existing !== id)].slice(0, limit);
}

/** Parses what localStorage held; anything unexpected is an empty list. */
export function parseRecent(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0).slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

export function recentStorageKey(entity: string): string {
  return `erp.lookup.recent.${entity}`;
}

/** Keeps only rows whose id is allowed (warehouse / cash account scopes); no list = everything. */
export function restrictToIds<T extends LookupRow>(rows: readonly T[], allowedIds?: readonly string[] | null): T[] {
  if (!allowedIds) return [...rows];
  const allowed = new Set(allowedIds);
  return rows.filter((row) => allowed.has(row.id));
}

/**
 * Prefill of the quick-create form from what was typed in the search: digits and "+" only look
 * like a phone number, so they go to the phone field; anything else becomes the name.
 */
export function quickCreatePrefill(query: string): { name: string; phone: string } {
  const text = query.replace(/\s+/g, " ").trim();
  if (!text) return { name: "", phone: "" };
  if (/^\+?[\d\s()-]{5,}$/.test(text)) return { name: "", phone: text };
  return { name: text, phone: "" };
}

/**
 * The form's own list after a quick-create: the new record first, or replacing the row with the
 * same id. Forms that look the selected record up in their list (credit limit, VÖEN, price tier)
 * keep working with a record created a second ago.
 */
export function mergeRecord<T extends LookupRow>(rows: readonly T[], record: T): T[] {
  return [record, ...rows.filter((row) => row.id !== record.id)];
}

/** One line label: the main text and, when present and different, the second text after " · ". */
export function joinLabel(main: string | null | undefined, extra?: string | null): string {
  const a = (main ?? "").trim();
  const b = (extra ?? "").trim();
  if (!a) return b;
  if (!b || b.toLocaleLowerCase("az") === a.toLocaleLowerCase("az")) return a;
  return `${a} · ${b}`;
}

/** The secondary info shown on the option's second line: the non-empty parts joined with " · ". */
export function joinHint(parts: ReadonlyArray<string | number | null | undefined>): string | undefined {
  const text = parts
    .map((part) => (part === null || part === undefined ? "" : String(part).trim()))
    .filter(Boolean)
    .join(" · ");
  return text || undefined;
}

// ── Quick-create validation (the same rules as the full pages) ────────────────────────────

export interface PartyDraft {
  fullName: string;
  companyName: string;
  phone: string;
  voen: string;
  legal: boolean;
}

/**
 * Customers and suppliers: a name is required; a legal entity also needs its company name and
 * VÖEN (customers page and supplier drawer rules). Returns an i18n key, or null when valid.
 */
export function validateParty(draft: PartyDraft): string | null {
  if (!draft.fullName.trim()) return "lookup.errors.nameRequired";
  if (draft.legal) {
    if (!draft.companyName.trim()) return "lookup.errors.companyRequired";
    if (!draft.voen.trim()) return "lookup.errors.voenRequired";
  }
  return null;
}

/** Row for customers / suppliers insert; the code follows the full pages ("CUST-1234"). */
export function partyPayload(draft: PartyDraft, codePrefix: "CUST" | "SUP", random: () => number = Math.random) {
  const fullName = draft.fullName.trim();
  const voen = draft.voen.trim();
  return {
    code: `${codePrefix}-${Math.floor(1000 + random() * 9000)}`,
    full_name: fullName,
    phone: draft.phone.trim() || null,
    company_name: draft.companyName.trim() || null,
    entity_type: draft.legal ? ("legal" as const) : ("physical" as const),
    voen: voen || null,
  };
}

/** Parses a typed price/length ("12,5" or "12.5"); empty or invalid → null, negatives → null. */
export function parseOptionalNumber(raw: string): number | null {
  const textValue = raw.trim().replace(",", ".");
  if (!textValue) return null;
  const n = Number(textValue);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
