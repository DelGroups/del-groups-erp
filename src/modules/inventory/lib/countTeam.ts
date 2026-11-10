/**
 * INV-4 (COUNT_TEAM): the people responsible for an inventory count. Pure: no React, no
 * Supabase, so the forms and the tests share it. The database keeps the chosen employees
 * (inventory_count_responsibles) and writes their names into responsible_name, which lists,
 * search, group by and exports keep using.
 */

/** An employee offered in the picker (inventory_count_employee_options): names only. */
export interface CountEmployeeOption {
  id: string;
  full_name: string;
  employee_code: string | null;
  position: string | null;
  department: string | null;
}

/** One chosen person of a count, as read back with the count. */
export interface CountResponsible {
  employee_id: string;
  full_name: string;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** RPC rows → options; rows without an id or a name are dropped. */
export function mapEmployeeOptionRows(rows: unknown): CountEmployeeOption[] {
  if (!Array.isArray(rows)) return [];
  const out: CountEmployeeOption[] = [];
  for (const row of rows as Record<string, unknown>[]) {
    const id = text(row?.id);
    const name = text(row?.full_name);
    if (!id || !name) continue;
    out.push({ id, full_name: name, employee_code: text(row.employee_code), position: text(row.position), department: text(row.department) });
  }
  return out;
}

/** inventory_count_responsibles rows joined with employees(full_name) → chosen people. */
export function mapResponsibleRows(rows: unknown): CountResponsible[] {
  if (!Array.isArray(rows)) return [];
  const out: CountResponsible[] = [];
  for (const row of rows as Record<string, unknown>[]) {
    const id = text(row?.employee_id);
    const employee = row?.employees as Record<string, unknown> | Record<string, unknown>[] | null | undefined;
    const name = text(Array.isArray(employee) ? employee[0]?.full_name : employee?.full_name) ?? text(row?.full_name);
    if (id && name) out.push({ employee_id: id, full_name: name });
  }
  return out;
}

/** The picker's second line: code · position · department. */
export function employeeOptionHint(option: Pick<CountEmployeeOption, "employee_code" | "position" | "department">): string | undefined {
  const parts = [option.employee_code, option.position, option.department].filter((v): v is string => !!v);
  return parts.length ? parts.join(" · ") : undefined;
}

/**
 * The options plus the people already on the count who are no longer offered (left HR), so a
 * chosen person never disappears from the picker. Sorted by name.
 */
export function withChosenOptions(options: readonly CountEmployeeOption[], chosen: readonly CountResponsible[], locale = "az"): CountEmployeeOption[] {
  const byId = new Map(options.map((o) => [o.id, o]));
  for (const c of chosen) {
    if (!byId.has(c.employee_id)) byId.set(c.employee_id, { id: c.employee_id, full_name: c.full_name, employee_code: null, position: null, department: null });
  }
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  return [...byId.values()].sort((a, b) => collator.compare(a.full_name, b.full_name));
}

/** Names of the chosen ids in the chosen order (unknown ids are skipped). */
export function teamNames(ids: readonly string[], options: readonly Pick<CountEmployeeOption, "id" | "full_name">[]): string[] {
  const byId = new Map(options.map((o) => [o.id, o.full_name]));
  return [...new Set(ids)].map((id) => byId.get(id)).filter((n): n is string => !!n);
}

/** The text the database writes into responsible_name: the names joined with ", ", or null. */
export function teamText(names: readonly string[]): string | null {
  const joined = names.map((n) => n.trim()).filter(Boolean).join(", ");
  return joined || null;
}

/**
 * What a count shows as responsible: the chosen people, or for an older count only its free text
 * (shown read-only above the picker until people are chosen).
 */
export function countTeamView(doc: { responsible_name: string | null; responsibles?: readonly CountResponsible[] }): {
  ids: string[];
  names: string[];
  legacyText: string | null;
} {
  const chosen = doc.responsibles ?? [];
  if (chosen.length) return { ids: chosen.map((c) => c.employee_id), names: chosen.map((c) => c.full_name), legacyText: null };
  return { ids: [], names: [], legacyText: text(doc.responsible_name) };
}

/** Did the chosen set change (order ignored)? Only then the form calls the RPC. */
export function teamChanged(before: readonly string[], after: readonly string[]): boolean {
  const a = new Set(before);
  const b = new Set(after);
  if (a.size !== b.size) return true;
  for (const id of a) if (!b.has(id)) return true;
  return false;
}

/** The order the database keeps (draft → in progress: anyone who may count; review, posted: admins). */
export function canEditCountTeam(status: string, isAdmin: boolean): boolean {
  if (status === "draft" || status === "in_progress") return true;
  return isAdmin && (status === "review" || status === "posted");
}

/** At most this many people per count (the RPC refuses more). */
export const MAX_COUNT_TEAM = 50;
