/**
 * Logic of the view engine (prompt 17), pure so `node --test` covers it: Studio custom fields
 * in the definition, filters and search, sorting, grouping (with date buckets and sums), pivot,
 * graph series, the calendar ranges and overlap layout, kanban columns and keyboard moves,
 * favourites (saved search state) and the Excel rows.
 */
import type { StudioField } from "../lib/studio/fields";
import { columnsForFlag, mergeColumnPrefs, type ColumnPrefs, type FlaggedColumnDef } from "../lib/lists/columns";
import { xlsxFileName, type XlsxCellType, type XlsxColumn } from "../lib/export/exportXlsx";
import type {
  Condition,
  DateGranularity,
  FieldDef,
  FieldType,
  FilterContext,
  FilterDef,
  GroupBySpec,
  SearchState,
  SortSpec,
  ViewDefinition,
  ViewRecord,
} from "./types";
import { dateFormat, formatFigure, formatGridDate, formatGridDateTime } from "@/lib/dates/localeDate";
import type { GridColumnType } from "../design-system/grid";

export interface Formatter {
  t: (key: string, params?: Record<string, string | number>) => string;
  locale: string;
}

const NUMERIC: ReadonlySet<FieldType> = new Set(["integer", "float", "monetary"]);
const DATES: ReadonlySet<FieldType> = new Set(["date", "datetime"]);
export const COUNT_MEASURE = "__count";
export const DEFAULT_LIMIT = 2000;

export const isNumericField = (f: FieldDef) => NUMERIC.has(f.type);
export const isDateField = (f: FieldDef) => DATES.has(f.type);

export function fieldMap(def: Pick<ViewDefinition, "fields">): Map<string, FieldDef> {
  return new Map(def.fields.map((f) => [f.name, f]));
}

export function fieldLabel(field: FieldDef, fmt: Pick<Formatter, "t">): string {
  return field.label ?? (field.labelKey ? fmt.t(field.labelKey) : field.name);
}

export function optionLabel(field: FieldDef, value: unknown, fmt: Pick<Formatter, "t">): string | null {
  const option = field.options?.find((o) => o.value === value);
  if (!option) return null;
  return option.label ?? (option.labelKey ? fmt.t(option.labelKey) : option.value);
}

// ── Access ───────────────────────────────────────────────────────────────────

/**
 * What the user may do with a model: nothing while its module is off for the tenant; admins
 * everything; others by permission. Row level security still decides on the server.
 */
export function accessFor(
  model: { module: string; readPermission: string; writePermission?: string },
  user: { isEnabled: (module: string) => boolean; isAdmin: boolean; can: (permission: string) => boolean }
): { read: boolean; write: boolean } {
  if (!user.isEnabled(model.module)) return { read: false, write: false };
  if (user.isAdmin) return { read: true, write: true };
  const read = user.can(model.readPermission);
  return { read, write: read && !!model.writePermission && user.can(model.writePermission) };
}

// ── Studio custom fields ─────────────────────────────────────────────────────

const STUDIO_TYPE: Record<StudioField["field_type"], FieldType> = {
  text: "char",
  textarea: "text",
  integer: "integer",
  decimal: "float",
  money: "monetary",
  date: "date",
  checkbox: "boolean",
  selection: "selection",
  url: "url",
};

export const CUSTOM_TAB_KEY = "custom";

/**
 * The definition with the model's active Studio fields added: as fields, as list columns when
 * "show in list" is on, as a form tab, in search and (selection, checkbox) in Group by.
 */
export function withStudioFields<R extends ViewRecord>(def: ViewDefinition<R>, studio: readonly StudioField[]): ViewDefinition<R> {
  const active = studio
    .filter((f) => f.active && f.model_key === def.model.studioModel && !def.fields.some((d) => d.name === f.name))
    .sort((a, b) => a.sequence - b.sequence || a.label.localeCompare(b.label));
  if (!def.model.studioModel || !active.length) return def;
  const fields: FieldDef[] = active.map((f) => ({
    name: f.name,
    label: f.label,
    type: STUDIO_TYPE[f.field_type],
    options: f.field_type === "selection" ? f.options.map((o) => ({ value: o.value, label: o.label })) : undefined,
    required: f.required,
    help: f.help ?? undefined,
    searchable: f.field_type === "text" || f.field_type === "textarea" || f.field_type === "selection",
    groupable: f.field_type === "selection" || f.field_type === "checkbox",
    custom: true,
  }));
  return {
    ...def,
    fields: [...def.fields, ...fields],
    groupBys: [...(def.groupBys ?? []), ...fields.filter((f) => f.groupable).map((f) => f.name)],
    list: { ...def.list, columns: [...def.list.columns, ...active.filter((f) => f.show_in_list).map((f) => f.name)] },
    form: {
      ...def.form,
      tabs: [...(def.form.tabs ?? []), { key: CUSTOM_TAB_KEY, labelKey: "views.customFields", fields: fields.map((f) => f.name) }],
    },
  };
}

/** Custom field values of a raw row, keyed like the fields (archived keys stay out of view). */
export function customValues(row: Record<string, unknown>, studio: readonly Pick<StudioField, "name" | "active">[]): Record<string, unknown> {
  const raw = row.custom_fields;
  const values = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const f of studio) if (f.active) out[f.name] = values[f.name] ?? null;
  return out;
}

/** Mistakes in a definition (unknown fields, a kanban on a non-selection field…). Empty = valid. */
export function validateDefinition(def: ViewDefinition): string[] {
  const errors: string[] = [];
  const fields = fieldMap(def);
  const need = (where: string, name: string | undefined) => {
    if (name && !fields.has(name) && name !== COUNT_MEASURE) errors.push(`${where}: unknown field "${name}"`);
  };
  if (fields.size !== def.fields.length) errors.push("fields: duplicate names");
  if (!def.views.length) errors.push("views: empty");
  def.list.columns.forEach((c) => need("list.columns", c));
  def.list.sums?.forEach((c) => need("list.sums", c));
  for (const spec of def.groupBys ?? []) need("groupBys", parseGroupBy(spec).field);
  need("form.title", def.form.title);
  need("form.statusField", def.form.statusField);
  def.form.fields.forEach((c) => need("form.fields", c));
  def.form.tabs?.forEach((tab) => tab.fields.forEach((c) => need(`form.tabs.${tab.key}`, c)));
  if (def.form.statusField && fields.get(def.form.statusField)?.type !== "selection") errors.push("form.statusField: must be a selection field");
  for (const view of def.views) if (!def[view]) errors.push(`views: "${view}" has no definition`);
  if (def.kanban) {
    need("kanban.groupBy", def.kanban.groupBy);
    need("kanban.title", def.kanban.title);
    need("kanban.subtitle", def.kanban.subtitle);
    need("kanban.amount", def.kanban.amount);
    def.kanban.fields?.forEach((c) => need("kanban.fields", c));
    if (fields.get(def.kanban.groupBy)?.type !== "selection") errors.push("kanban.groupBy: must be a selection field");
  }
  if (def.pivot) {
    need("pivot.rows", parseGroupBy(def.pivot.rows).field);
    if (def.pivot.cols) need("pivot.cols", parseGroupBy(def.pivot.cols).field);
    need("pivot.measure", def.pivot.measure);
  }
  if (def.graph) {
    need("graph.groupBy", parseGroupBy(def.graph.groupBy).field);
    need("graph.measure", def.graph.measure);
  }
  if (def.calendar) {
    need("calendar.dateField", def.calendar.dateField);
    need("calendar.endField", def.calendar.endField);
    need("calendar.title", def.calendar.title);
    need("calendar.colorField", def.calendar.colorField);
    const f = fields.get(def.calendar.dateField);
    if (f && !isDateField(f)) errors.push("calendar.dateField: must be a date field");
  }
  for (const m of [def.pivot?.measure, def.graph?.measure]) {
    const f = m && m !== COUNT_MEASURE ? fields.get(m) : undefined;
    if (f && !isNumericField(f)) errors.push(`measure "${m}": must be numeric`);
  }
  return errors;
}

// ── Filters and search ───────────────────────────────────────────────────────

export function normalizeText(value: string): string {
  return value
    .replace(/İ/g, "i")
    .replace(/ı/g, "i")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ə/g, "e");
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/** Dates (Date objects and ISO strings) compare as time, so "2026-10-01" vs a timestamp works. */
function comparable(value: unknown): number | string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" && ISO_DATE.test(value)) return toDate(value)?.getTime() ?? value;
  return String(value);
}

export function matchesCondition(record: ViewRecord, c: Condition): boolean {
  const v = record[c.field];
  switch (c.op) {
    case "set":
      return v !== null && v !== undefined && v !== "" && v !== false;
    case "not_set":
      return v === null || v === undefined || v === "" || v === false;
    case "eq":
      return v === c.value;
    case "neq":
      return v !== c.value;
    case "in":
      return Array.isArray(c.value) && c.value.includes(v);
    case "contains":
      return typeof v === "string" && normalizeText(v).includes(normalizeText(String(c.value ?? "")));
    default: {
      const a = comparable(v);
      const b = comparable(c.value);
      if (a === null || b === null) return false;
      if (c.op === "gt") return a > b;
      if (c.op === "gte") return a >= b;
      if (c.op === "lt") return a < b;
      return a <= b;
    }
  }
}

/** Active filters: OR inside a group, AND between groups. Unknown filter keys are ignored. */
export function matchesFilters(record: ViewRecord, filters: readonly FilterDef[], active: readonly string[], ctx: FilterContext): boolean {
  const groups = new Map<string, FilterDef[]>();
  for (const f of filters) {
    if (!active.includes(f.key)) continue;
    groups.set(f.group, [...(groups.get(f.group) ?? []), f]);
  }
  for (const group of groups.values()) {
    if (!group.some((f) => f.conditions(ctx).every((c) => matchesCondition(record, c)))) return false;
  }
  return true;
}

/** Every word of the query appears in one of the searchable fields (labels of options too). */
export function matchesSearch(record: ViewRecord, def: Pick<ViewDefinition, "fields">, query: string, fmt: Pick<Formatter, "t">): boolean {
  const words = normalizeText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = normalizeText(
    def.fields
      .filter((f) => f.searchable)
      .map((f) => {
        const v = record[f.name];
        if (f.type === "selection") return optionLabel(f, v, fmt) ?? String(v ?? "");
        if (f.type === "many2one") return String((f.displayField ? record[f.displayField] : null) ?? "");
        return v === null || v === undefined ? "" : String(v);
      })
      .join(" ")
  );
  return words.every((w) => hay.includes(w));
}

export function applySearch<R extends ViewRecord>(records: readonly R[], def: ViewDefinition<R>, state: Pick<SearchState, "search" | "filters">, ctx: FilterContext, fmt: Pick<Formatter, "t">): R[] {
  const filters = def.filters ?? [];
  return records.filter((r) => matchesFilters(r, filters, state.filters, ctx) && matchesSearch(r, def, state.search, fmt));
}

// ── Date helpers (local time) ────────────────────────────────────────────────

export function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string" || !value) return null;
  // A plain date is a local calendar day, not UTC midnight.
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const d = plain ? new Date(Number(plain[1]), Number(plain[2]) - 1, Number(plain[3])) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
}

/** Monday of the week of `d`. */
export function startOfWeek(d: Date): Date {
  const day = startOfDay(d);
  return addDays(day, -((day.getDay() + 6) % 7));
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** ISO 8601 week number and its year. */
export function isoWeek(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return { year: t.getUTCFullYear(), week: Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7) };
}

export function dateBucket(value: unknown, granularity: DateGranularity): string | null {
  const d = toDate(value);
  if (!d) return null;
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  switch (granularity) {
    case "day":
      return dayKey(d);
    case "week": {
      const w = isoWeek(d);
      return `${w.year}-W${String(w.week).padStart(2, "0")}`;
    }
    case "month":
      return `${y}-${String(m).padStart(2, "0")}`;
    case "quarter":
      return `${y}-Q${Math.ceil(m / 3)}`;
    default:
      return String(y);
  }
}

function bucketLabel(key: string, granularity: DateGranularity, locale: string): string {
  if (granularity === "month") {
    const [y, m] = key.split("-").map(Number);
    return dateFormat(locale, { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1));
  }
  if (granularity === "day") {
    const [y, m, d] = key.split("-").map(Number);
    return dateFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(new Date(y, m - 1, d));
  }
  return key;
}

// ── Display ──────────────────────────────────────────────────────────────────

export function formatNumber(value: number, digits: number, locale: string): string {
  return formatFigure(value, digits, locale);
}

/** Text of a value in lists, cards, groups and Excel headers. Empty values give "". */
export function displayValue(field: FieldDef, record: ViewRecord, fmt: Formatter): string {
  const v = record[field.name];
  switch (field.type) {
    case "boolean":
      return v === true ? fmt.t("views.yes") : v === false ? fmt.t("views.no") : "";
    case "selection":
      return optionLabel(field, v, fmt) ?? (v === null || v === undefined ? "" : String(v));
    case "many2one":
      return String((field.displayField ? record[field.displayField] : null) ?? optionLabel(field, v, fmt) ?? "");
    case "integer":
      return typeof v === "number" ? formatNumber(v, 0, fmt.locale) : "";
    case "float":
      return typeof v === "number" ? formatNumber(v, 2, fmt.locale) : "";
    case "monetary":
      return typeof v === "number" ? `${formatNumber(v, 2, fmt.locale)} ${fmt.t("common.currency")}` : "";
    case "date":
    case "datetime": {
      // Grids and cells: numeric dd.mm.yyyy (HH:mm) in every language (docs/ui-standard.md).
      const d = toDate(v);
      if (!d) return "";
      return field.type === "date" ? formatGridDate(typeof v === "string" ? v : d) : formatGridDateTime(d);
    }
    default:
      return v === null || v === undefined ? "" : String(v);
  }
}

// ── Sorting ──────────────────────────────────────────────────────────────────

/** Sort key of a value: numbers, dates as time, selection by option order, text normalized. */
function sortKey(field: FieldDef | undefined, record: ViewRecord): number | string | null {
  if (!field) return null;
  const v = record[field.name];
  if (v === null || v === undefined || v === "") return null;
  if (isNumericField(field)) return typeof v === "number" ? v : Number(v);
  if (isDateField(field)) return toDate(v)?.getTime() ?? null;
  if (field.type === "boolean") return v ? 1 : 0;
  if (field.type === "selection") {
    const i = field.options?.findIndex((o) => o.value === v) ?? -1;
    return i >= 0 ? i : Number.MAX_SAFE_INTEGER;
  }
  if (field.type === "many2one") return normalizeText(String((field.displayField ? record[field.displayField] : v) ?? ""));
  return normalizeText(String(v));
}

/** Stable sort; empty values last in both directions. */
export function sortRecords<R extends ViewRecord>(records: readonly R[], def: Pick<ViewDefinition, "fields">, sort: SortSpec | null): R[] {
  if (!sort) return [...records];
  const field = fieldMap(def).get(sort.field);
  const dir = sort.dir === "asc" ? 1 : -1;
  return records
    .map((r, i) => ({ r, i, k: sortKey(field, r) }))
    .sort((a, b) => {
      if (a.k === null || b.k === null) return a.k === b.k ? a.i - b.i : a.k === null ? 1 : -1;
      if (a.k < b.k) return -dir;
      if (a.k > b.k) return dir;
      return a.i - b.i;
    })
    .map((x) => x.r);
}

/** Header click: ascending, then descending, then back to the default. */
export function nextSort(current: SortSpec | null, field: string): SortSpec | null {
  if (!current || current.field !== field) return { field, dir: "asc" };
  return current.dir === "asc" ? { field, dir: "desc" } : null;
}

// ── Grouping ─────────────────────────────────────────────────────────────────

export const EMPTY_GROUP = "__none";
const GRANULARITIES: readonly DateGranularity[] = ["day", "week", "month", "quarter", "year"];

export function parseGroupBy(spec: GroupBySpec): { field: string; granularity: DateGranularity | null } {
  const [field, g] = spec.split(":");
  return { field, granularity: (GRANULARITIES as readonly string[]).includes(g) ? (g as DateGranularity) : null };
}

interface GroupKey {
  key: string;
  label: string;
  /** Order of the group (option index, date, text). */
  order: number | string;
  color?: string;
}

export function groupKeyOf(field: FieldDef, granularity: DateGranularity | null, record: ViewRecord, fmt: Formatter): GroupKey {
  const v = record[field.name];
  const empty: GroupKey = { key: EMPTY_GROUP, label: fmt.t("views.none"), order: "￿" };
  if (isDateField(field)) {
    const g = granularity ?? "month";
    const key = dateBucket(v, g);
    return key ? { key, label: bucketLabel(key, g, fmt.locale), order: key } : empty;
  }
  if (v === null || v === undefined || v === "") return empty;
  if (field.type === "selection") {
    const i = field.options?.findIndex((o) => o.value === v) ?? -1;
    return { key: String(v), label: optionLabel(field, v, fmt) ?? String(v), order: i >= 0 ? i : 1e9, color: field.options?.[i]?.color };
  }
  if (field.type === "boolean") return { key: v ? "true" : "false", label: displayValue(field, record, fmt), order: v ? 0 : 1 };
  if (field.type === "many2one") {
    const label = displayValue(field, record, fmt) || String(v);
    return { key: String(v), label, order: normalizeText(label) };
  }
  if (isNumericField(field)) return { key: String(v), label: displayValue(field, record, fmt), order: Number(v) };
  return { key: String(v), label: String(v), order: normalizeText(String(v)) };
}

export interface RecordGroup<R extends ViewRecord = ViewRecord> {
  /** Unique path of the group ("stage=WON/created_at=2026-10"). */
  path: string;
  field: string;
  key: string;
  label: string;
  color?: string;
  count: number;
  sums: Record<string, number>;
  records: R[];
  children: RecordGroup<R>[];
}

export function sumBy(records: readonly ViewRecord[], field: string): number {
  let total = 0;
  for (const r of records) {
    const v = r[field];
    if (typeof v === "number" && Number.isFinite(v)) total += v;
  }
  return Math.round(total * 100) / 100;
}

/**
 * Nested groups for "Group by" (one level per spec). Groups come in a natural order (option
 * order, date, name) with the empty group last; each carries its count and the requested sums.
 */
export function groupRecords<R extends ViewRecord>(records: readonly R[], def: Pick<ViewDefinition, "fields">, specs: readonly GroupBySpec[], sums: readonly string[], fmt: Formatter, parent = ""): RecordGroup<R>[] {
  if (!specs.length) return [];
  const [spec, ...rest] = specs;
  const { field: name, granularity } = parseGroupBy(spec);
  const field = fieldMap(def).get(name);
  if (!field) return groupRecords(records, def, rest, sums, fmt, parent);
  const buckets = new Map<string, { gk: GroupKey; records: R[] }>();
  for (const r of records) {
    const gk = groupKeyOf(field, granularity, r, fmt);
    const b = buckets.get(gk.key);
    if (b) b.records.push(r);
    else buckets.set(gk.key, { gk, records: [r] });
  }
  return [...buckets.values()]
    .sort((a, b) => {
      if (a.gk.key === EMPTY_GROUP || b.gk.key === EMPTY_GROUP) return a.gk.key === EMPTY_GROUP ? 1 : -1;
      return a.gk.order < b.gk.order ? -1 : a.gk.order > b.gk.order ? 1 : 0;
    })
    .map(({ gk, records: rs }) => {
      const path = `${parent}${parent ? "/" : ""}${name}=${gk.key}`;
      return {
        path,
        field: name,
        key: gk.key,
        label: gk.label,
        color: gk.color,
        count: rs.length,
        sums: Object.fromEntries(sums.map((s) => [s, sumBy(rs, s)])),
        records: rs,
        children: groupRecords(rs, def, rest, sums, fmt, path),
      };
    });
}

// ── Pivot and graph ──────────────────────────────────────────────────────────

export function measureOf(records: readonly ViewRecord[], measure: string): number {
  return measure === COUNT_MEASURE ? records.length : sumBy(records, measure);
}

export interface PivotTable {
  rows: { key: string; label: string }[];
  cols: { key: string; label: string }[];
  /** cells[row][col]; null where no record falls. */
  cells: (number | null)[][];
  rowTotals: number[];
  colTotals: number[];
  total: number;
}

export function pivotTable(records: readonly ViewRecord[], def: Pick<ViewDefinition, "fields">, rowsSpec: GroupBySpec, colsSpec: GroupBySpec | null, measure: string, fmt: Formatter): PivotTable {
  const rowGroups = groupRecords(records, def, [rowsSpec], [], fmt);
  const colGroups = colsSpec ? groupRecords(records, def, [colsSpec], [], fmt) : [];
  const cols = colGroups.length ? colGroups.map((g) => ({ key: g.key, label: g.label })) : [{ key: "__all", label: fmt.t("views.total") }];
  const colOf = new Map<string, string>();
  for (const g of colGroups) for (const r of g.records) colOf.set(r.id, g.key);
  const cells = rowGroups.map((rg) =>
    cols.map((c) => {
      const inCell = colGroups.length ? rg.records.filter((r) => colOf.get(r.id) === c.key) : rg.records;
      return inCell.length ? measureOf(inCell, measure) : null;
    })
  );
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    rows: rowGroups.map((g) => ({ key: g.key, label: g.label })),
    cols,
    cells,
    rowTotals: rowGroups.map((g) => measureOf(g.records, measure)),
    colTotals: cols.map((_, ci) => round(cells.reduce((s, row) => s + (row[ci] ?? 0), 0))),
    total: measureOf(records, measure),
  };
}

export interface GraphPoint {
  key: string;
  label: string;
  value: number;
  color?: string;
}

export function graphSeries(records: readonly ViewRecord[], def: Pick<ViewDefinition, "fields">, spec: GroupBySpec, measure: string, fmt: Formatter): GraphPoint[] {
  return groupRecords(records, def, [spec], [], fmt).map((g) => ({ key: g.key, label: g.label, value: measureOf(g.records, measure), color: g.color }));
}

// ── Calendar ─────────────────────────────────────────────────────────────────

export type CalendarMode = "day" | "week" | "month";

/** Days shown: one day, Monday–Sunday, or the whole weeks covering the month. */
export function calendarDays(mode: CalendarMode, anchor: Date): Date[] {
  if (mode === "day") return [startOfDay(anchor)];
  if (mode === "week") {
    const start = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const start = startOfWeek(first);
  const end = addDays(startOfWeek(last), 6);
  const days: Date[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

export function shiftAnchor(mode: CalendarMode, anchor: Date, step: -1 | 1): Date {
  if (mode === "day") return addDays(anchor, step);
  if (mode === "week") return addDays(anchor, 7 * step);
  return new Date(anchor.getFullYear(), anchor.getMonth() + step, 1);
}

export interface CalendarEvent<R extends ViewRecord = ViewRecord> {
  record: R;
  start: Date;
  end: Date;
  /** Column and column count inside its day when events overlap (time grid). */
  col: number;
  cols: number;
}

/** Events of the records falling on the given days, keyed by day ("2026-10-14"). */
export function calendarEvents<R extends ViewRecord>(records: readonly R[], days: readonly Date[], dateField: string, endField: string | undefined, defaultMinutes = 30): Map<string, CalendarEvent<R>[]> {
  const byDay = new Map<string, CalendarEvent<R>[]>(days.map((d) => [dayKey(d), []]));
  for (const record of records) {
    const start = toDate(record[dateField]);
    if (!start) continue;
    const list = byDay.get(dayKey(start));
    if (!list) continue;
    const endRaw = endField ? toDate(record[endField]) : null;
    const end = endRaw && endRaw > start ? endRaw : new Date(start.getTime() + defaultMinutes * 60000);
    list.push({ record, start, end, col: 0, cols: 1 });
  }
  for (const list of byDay.values()) layoutOverlaps(list);
  return byDay;
}

/** Side-by-side columns for overlapping events of one day (in place, sorted by start). */
export function layoutOverlaps<E extends { start: Date; end: Date; col: number; cols: number }>(events: E[]): E[] {
  events.sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime());
  let cluster: E[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const ends: number[] = [];
    for (const e of cluster) {
      let col = ends.findIndex((end) => end <= e.start.getTime());
      if (col < 0) col = ends.length;
      ends[col] = e.end.getTime();
      e.col = col;
    }
    for (const e of cluster) e.cols = ends.length;
    cluster = [];
  };
  for (const e of events) {
    if (cluster.length && e.start.getTime() >= clusterEnd) flush();
    cluster.push(e);
    clusterEnd = cluster.length === 1 ? e.end.getTime() : Math.max(clusterEnd, e.end.getTime());
  }
  if (cluster.length) flush();
  return events;
}

// ── Kanban ───────────────────────────────────────────────────────────────────

export interface KanbanColumn<R extends ViewRecord = ViewRecord> {
  key: string;
  label: string;
  color?: string;
  records: R[];
  sum: number | null;
}

/** One column per option; records with an unknown value go to the first column (as before). */
export function kanbanColumns<R extends ViewRecord>(records: readonly R[], field: FieldDef, amount: string | undefined, fmt: Pick<Formatter, "t">): KanbanColumn<R>[] {
  const options = field.options ?? [];
  const columns = options.map((o) => ({ key: o.value, label: o.label ?? (o.labelKey ? fmt.t(o.labelKey) : o.value), color: o.color, records: [] as R[], sum: null as number | null }));
  if (!columns.length) return [];
  const byKey = new Map(columns.map((c) => [c.key, c]));
  for (const r of records) (byKey.get(String(r[field.name])) ?? columns[0]).records.push(r);
  for (const c of columns) c.sum = amount ? sumBy(c.records, amount) : null;
  return columns;
}

/** The record moved to another column value (optimistic update before the server answers). */
export function moveRecord<R extends ViewRecord>(records: readonly R[], id: string, field: string, value: string): R[] {
  return records.map((r) => (r.id === id ? { ...r, [field]: value } : r));
}

/** Keyboard move of a picked-up card: ←/→ one column, Home/End first/last. Null = no move. */
export function kanbanKeyTarget(columnKeys: readonly string[], current: string, key: string): string | null {
  const i = columnKeys.indexOf(current);
  if (i < 0) return null;
  const at = key === "ArrowLeft" ? i - 1 : key === "ArrowRight" ? i + 1 : key === "Home" ? 0 : key === "End" ? columnKeys.length - 1 : -1;
  if (at < 0 || at >= columnKeys.length || at === i) return null;
  return columnKeys[at];
}

// ── Search state and favourites ──────────────────────────────────────────────

export function defaultSearchState(def: Pick<ViewDefinition, "views" | "defaultSort">): SearchState {
  return { search: "", filters: [], groupBy: [], sort: def.defaultSort ?? null, view: def.views[0] };
}

const MAX_GROUP_LEVELS = 3;

/**
 * A saved state read back (favourite, browser storage): anything unknown to the current
 * definition is dropped, so a favourite never breaks after fields or filters change.
 */
export function sanitizeSearchState(raw: unknown, def: ViewDefinition): SearchState {
  const base = defaultSearchState(def);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const s = raw as Record<string, unknown>;
  const fields = fieldMap(def);
  const filterKeys = new Set((def.filters ?? []).map((f) => f.key));
  const groupable = new Set(def.groupBys ?? []);
  const view = typeof s.view === "string" && (def.views as readonly string[]).includes(s.view) ? (s.view as SearchState["view"]) : base.view;
  const sortRaw = s.sort as Record<string, unknown> | null | undefined;
  const sort =
    sortRaw && typeof sortRaw === "object" && typeof sortRaw.field === "string" && fields.has(sortRaw.field) && (sortRaw.dir === "asc" || sortRaw.dir === "desc")
      ? { field: sortRaw.field, dir: sortRaw.dir as "asc" | "desc" }
      : s.sort === null
        ? null
        : base.sort;
  return {
    search: typeof s.search === "string" ? s.search.slice(0, 200) : "",
    filters: Array.isArray(s.filters) ? [...new Set(s.filters.filter((k): k is string => typeof k === "string" && filterKeys.has(k)))] : [],
    groupBy: Array.isArray(s.groupBy) ? [...new Set(s.groupBy.filter((k): k is string => typeof k === "string" && groupable.has(k)))].slice(0, MAX_GROUP_LEVELS) : [],
    sort,
    view,
    // A favourite saved with its columns (prompt 24c) brings them back; without, the user's own.
    ...(s.columns && typeof s.columns === "object" ? { columns: mergeColumnPrefs(listColumnDefs(def), s.columns) } : {}),
  };
}

/** Toggle a value in a list (filters, group by levels). Group by keeps its order of choice. */
export function toggleIn(list: readonly string[], value: string, max = Infinity): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value].slice(0, max);
}
export const toggleGroupBy = (list: readonly string[], value: string) => toggleIn(list, value, MAX_GROUP_LEVELS);

export interface Favorite {
  id: string;
  name: string;
  isDefault: boolean;
  state: SearchState;
}

export const FAVORITE_NAME_MAX = 80;

export function validFavoriteName(name: string): string | null {
  const trimmed = name.trim().replace(/\s+/g, " ");
  return trimmed && trimmed.length <= FAVORITE_NAME_MAX ? trimmed : null;
}

/** The favourite applied when the view opens: the user's default one, if any. */
export function defaultFavorite(favorites: readonly Favorite[]): Favorite | null {
  return favorites.find((f) => f.isDefault) ?? null;
}

// ── Excel ────────────────────────────────────────────────────────────────────

/** Header + one row per record, numbers and booleans as values, the rest as display text. */
export function exportRows(records: readonly ViewRecord[], def: Pick<ViewDefinition, "fields">, columns: readonly string[], fmt: Formatter): (string | number | boolean | null)[][] {
  const fields = fieldMap(def);
  const cols = columns.map((c) => fields.get(c)).filter((f): f is FieldDef => !!f);
  return [
    cols.map((f) => fieldLabel(f, fmt)),
    ...records.map((r) =>
      cols.map((f) => {
        const v = r[f.name];
        if (isNumericField(f)) return typeof v === "number" ? v : null;
        if (f.type === "boolean") return typeof v === "boolean" ? v : null;
        if (f.type === "date") return typeof v === "string" ? v.slice(0, 10) : null;
        return displayValue(f, r, fmt) || null;
      })
    ),
  ];
}

/** "CRM_deals-2026-10-14.xlsx" (prompt 24c: "<list>-<yyyy-mm-dd>.xlsx"). */
export function exportFileName(title: string, now: Date): string {
  return xlsxFileName(title, now);
}

const XLSX_TYPE: Partial<Record<FieldType, XlsxCellType>> = { monetary: "money", integer: "integer", float: "number", date: "date", datetime: "datetime" };

/**
 * Excel columns of a list (prompt 24c): the columns the user sees, in their order. Numbers and
 * dates keep their types; everything else is the text the list shows.
 */
export function exportColumns(def: Pick<ViewDefinition, "fields" | "list">, columns: readonly string[], fmt: Formatter, enabled = false): XlsxColumn<ViewRecord>[] {
  const fields = fieldMap(def);
  return columns
    .map((c) => fields.get(c))
    .filter((f): f is FieldDef => !!f)
    .map((f) => {
      const type = XLSX_TYPE[f.type];
      return {
        header: listFieldLabel(f, def, enabled, fmt),
        type: type ?? "text",
        value: (r: ViewRecord) => (type ? r[f.name] : displayValue(f, r, fmt) || null),
      };
    });
}

// ── List columns (prompt 24c) ────────────────────────────────────────────────

/**
 * Every column the picker offers, in its default order: the list's columns (shown; the first
 * cannot be hidden), the standard columns (shown while LIST_COLUMNS is on), the optional ones,
 * then every other field of the definition but internal ones (hidden).
 */
export function listColumnDefs(def: Pick<ViewDefinition, "fields" | "list">): FlaggedColumnDef[] {
  const fields = fieldMap(def);
  const out: FlaggedColumnDef[] = [];
  const seen = new Set<string>();
  const add = (name: string, defaultVisible: boolean, standard = false) => {
    const f = fields.get(name);
    if (!f || f.internal || seen.has(name)) return;
    seen.add(name);
    out.push({ key: name, labelKey: f.labelKey ?? name, defaultVisible, required: out.length === 0 || undefined, numeric: isNumericField(f) || undefined, standard: standard || undefined });
  };
  for (const c of def.list.columns) add(c, true);
  for (const c of def.list.standard ?? []) add(c, true, true);
  for (const c of def.list.optional ?? []) add(c, false);
  for (const f of def.fields) add(f.name, false);
  return out;
}

/** The column keys a list shows: today's columns while the flag is off, else the user's choice. */
export function shownListColumns(def: Pick<ViewDefinition, "fields" | "list">, enabled: boolean, prefs: ColumnPrefs | undefined): string[] {
  if (!enabled || !prefs) {
    const fields = fieldMap(def);
    return def.list.columns.filter((c) => fields.has(c));
  }
  return columnsForFlag(listColumnDefs(def), true, prefs).map((c) => c.key);
}

/** Header of a list column: the list's own label for it while LIST_COLUMNS is on ("Invoice date"). */
export function listFieldLabel(field: FieldDef, def: Pick<ViewDefinition, "list">, enabled: boolean, fmt: Pick<Formatter, "t">): string {
  const own = enabled ? def.list.standardLabels?.[field.name] : undefined;
  return own ? fmt.t(own) : fieldLabel(field, fmt);
}

// ── Form ─────────────────────────────────────────────────────────────────────

/** Required fields left empty (field names). */
export function missingRequired(fields: readonly FieldDef[], draft: Record<string, unknown>): string[] {
  return fields
    .filter((f) => f.required && !f.readonly && f.type !== "boolean")
    .filter((f) => {
      const v = draft[f.name];
      return v === null || v === undefined || (typeof v === "string" && !v.trim());
    })
    .map((f) => f.name);
}

/** Only the editable fields whose value changed. */
export function changedValues(fields: readonly FieldDef[], original: ViewRecord, draft: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.readonly || !(f.name in draft)) continue;
    const a = original[f.name] ?? null;
    const b = draft[f.name] ?? null;
    if (a !== b) out[f.name] = b;
  }
  return out;
}

/** Form input text → field value (numbers parsed, empty → null). */
export function parseInput(field: FieldDef, raw: string | boolean): unknown {
  if (field.type === "boolean") return raw === true;
  const text = String(raw);
  if (!text.trim()) return null;
  if (isNumericField(field)) {
    const n = Number(text.replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(n)) return null;
    return field.type === "integer" ? Math.trunc(n) : field.type === "monetary" ? Math.round(n * 100) / 100 : n;
  }
  return text;
}

// ── Dashboard figures ────────────────────────────────────────────────────────

export const sumIf = <R extends ViewRecord>(records: readonly R[], value: (r: R) => number, when: (r: R) => boolean = () => true): number =>
  Math.round(records.reduce((s, r) => (when(r) ? s + (Number(value(r)) || 0) : s), 0) * 100) / 100;

export const countIf = <R extends ViewRecord>(records: readonly R[], when: (r: R) => boolean): number => records.reduce((n, r) => (when(r) ? n + 1 : n), 0);

/** Totals per week for the last `weeks` weeks (Monday-based, the last one is this week). */
export function weeklySeries<R extends ViewRecord>(records: readonly R[], date: (r: R) => unknown, value: (r: R) => number, now: Date, weeks = 8): number[] {
  const out = Array<number>(weeks).fill(0);
  const first = addDays(startOfWeek(now), -7 * (weeks - 1));
  for (const r of records) {
    const d = toDate(date(r));
    if (!d) continue;
    const i = Math.round((startOfWeek(d).getTime() - first.getTime()) / (7 * 86400000));
    if (i >= 0 && i < weeks) out[i] += Number(value(r)) || 0;
  }
  return out.map((v) => Math.round(v * 100) / 100);
}

/** This month's and last month's totals and the change in percent (null without last month). */
export function monthTotals<R extends ViewRecord>(records: readonly R[], date: (r: R) => unknown, value: (r: R) => number, now: Date): { current: number; previous: number; delta: number | null } {
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  let current = 0;
  let previous = 0;
  for (const r of records) {
    const d = toDate(date(r));
    if (!d) continue;
    if (d >= thisMonth) current += Number(value(r)) || 0;
    else if (d >= lastMonth) previous += Number(value(r)) || 0;
  }
  current = Math.round(current * 100) / 100;
  previous = Math.round(previous * 100) / 100;
  return { current, previous, delta: previous > 0 ? Math.round(((current - previous) / previous) * 100) : null };
}

/** "12,480 AZN" in the user's language. */
export const money = (n: number, fmt: Formatter, digits = 0): string => `${formatNumber(n, digits, fmt.locale)} ${fmt.t("common.currency")}`;
export const figure = (n: number, fmt: Formatter, digits = 0): string => formatNumber(n, digits, fmt.locale);

// ── DataGrid (UI-2) ──────────────────────────────────────────────────────────

/** Width class of a field's column in DataGrid (docs/ui-standard.md "Lists"). */
export function gridColumnType(field: FieldDef): GridColumnType {
  switch (field.type) {
    case "monetary":
      return "money";
    case "integer":
    case "float":
      return "number";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    case "selection":
      return "status";
    default:
      return "text";
  }
}

export type FlatGroupItem<R extends ViewRecord> = { kind: "group"; group: RecordGroup<R>; depth: number } | { kind: "row"; record: R; depth: number };

/** Groups and rows in screen order: a group's children (or records) follow it only while it is open. */
export function flattenGroups<R extends ViewRecord>(groups: readonly RecordGroup<R>[], open: ReadonlySet<string>, depth = 0): FlatGroupItem<R>[] {
  return groups.flatMap((group): FlatGroupItem<R>[] => {
    const head: FlatGroupItem<R> = { kind: "group", group, depth };
    if (!open.has(group.path)) return [head];
    const inner: FlatGroupItem<R>[] = group.children.length
      ? flattenGroups(group.children, open, depth + 1)
      : group.records.map((record) => ({ kind: "row" as const, record, depth: depth + 1 }));
    return [head, ...inner];
  });
}
