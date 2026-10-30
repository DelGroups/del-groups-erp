/**
 * Names of the users behind created_by / issued_by columns (prompt 24c), for lists. One batched
 * call per page through profile_display_names(p_ids) (security definer: any signed-in user may
 * read names, nothing else of other profiles). Before that migration runs it falls back to a
 * plain profiles read, which row level security limits to the user's own profile (and to user
 * managers). A uuid is never shown: unknown ids stay null and lists print "—".
 */

/** The parts of the Supabase client used here, so tests can pass a fake. */
export interface ProfileNamesClient {
  rpc: (fn: "profile_display_names", args: { p_ids: string[] }) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
  from: (table: "profiles") => {
    select: (columns: string) => { in: (column: string, values: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }> };
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Distinct uuids found in the given fields of the rows. */
export function collectProfileIds(rows: readonly Record<string, unknown>[], fields: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    for (const field of fields) {
      const v = row[field];
      if (typeof v === "string" && UUID.test(v)) ids.add(v.toLowerCase());
    }
  }
  return [...ids];
}

/** (id, full_name) rows → id → trimmed name; empty names are left out. */
export function namesFromRows(data: unknown): Map<string, string> {
  const names = new Map<string, string>();
  if (!Array.isArray(data)) return names;
  for (const row of data as { id?: unknown; full_name?: unknown }[]) {
    if (typeof row?.id !== "string") continue;
    const name = typeof row.full_name === "string" ? row.full_name.trim() : "";
    if (name) names.set(row.id.toLowerCase(), name);
  }
  return names;
}

/** The display name of an id, or null (never the uuid). */
export function profileName(names: ReadonlyMap<string, string>, id: unknown): string | null {
  return typeof id === "string" && id ? names.get(id.toLowerCase()) ?? null : null;
}

/**
 * Copies of the rows with `nameField` filled from `idField` for every [idField, nameField] pair.
 * A name the row already carries (e.g. a stored created_by_name) wins.
 */
export function attachProfileNames<T extends Record<string, unknown>>(
  rows: readonly T[],
  pairs: readonly (readonly [idField: string, nameField: string])[],
  names: ReadonlyMap<string, string>
): T[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row };
    for (const [idField, nameField] of pairs) {
      const own = typeof row[nameField] === "string" && (row[nameField] as string).trim() ? row[nameField] : null;
      out[nameField] = own ?? profileName(names, row[idField]);
    }
    return out as T;
  });
}

const MISSING_FUNCTION = new Set(["PGRST202", "42883"]);
const CHUNK = 200;

export async function fetchProfileDisplayNames(client: ProfileNamesClient, ids: readonly string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = [...new Set(ids.filter((id) => UUID.test(id)).map((id) => id.toLowerCase()))];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const part = unique.slice(i, i + CHUNK);
    const { data, error } = await client.rpc("profile_display_names", { p_ids: part });
    if (!error) {
      for (const [id, name] of namesFromRows(data)) names.set(id, name);
      continue;
    }
    if (!MISSING_FUNCTION.has(error.code ?? "")) continue;
    const fallback = await client.from("profiles").select("id, full_name").in("id", part);
    if (!fallback.error) for (const [id, name] of namesFromRows(fallback.data)) names.set(id, name);
  }
  return names;
}

/** Rows with their user names, in one batched lookup. */
export async function withProfileNames<T extends Record<string, unknown>>(
  client: ProfileNamesClient,
  rows: readonly T[],
  pairs: readonly (readonly [idField: string, nameField: string])[]
): Promise<T[]> {
  if (!rows.length || !pairs.length) return [...rows];
  const ids = collectProfileIds(rows, pairs.map(([id]) => id));
  const names = ids.length ? await fetchProfileDisplayNames(client, ids) : new Map<string, string>();
  return attachProfileNames(rows, pairs, names);
}
