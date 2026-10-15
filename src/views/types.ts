/**
 * View definitions of the metadata-driven view engine (prompt 17, plan §6.1).
 *
 * A screen describes its model once (table, module, permissions, how a row becomes a flat
 * record) and its fields; the engine renders list, kanban, form, pivot, graph and calendar
 * views, the shared search panel and Excel export from that description. Studio custom fields
 * of the model are appended to the fields automatically, so they show up in every view.
 *
 * Pure types: no React, Next or Supabase imports, so `node --test` can load the logic.
 */

export type FieldType =
  | "char"
  | "text"
  | "integer"
  | "float"
  | "monetary"
  | "date"
  | "datetime"
  | "boolean"
  | "selection"
  | "many2one"
  | "url";

export interface SelectionOption {
  value: string;
  /** Shown as is (tenant-defined labels, e.g. pipeline stages). */
  label?: string;
  /** i18n key, used when `label` is not given. */
  labelKey?: string;
  /** CSS colour of the option (kanban column, status bar, chip). */
  color?: string;
}

export interface FieldDef {
  /** Key of the value in a flat record. Studio custom fields keep their `x_` name. */
  name: string;
  /** i18n key of the label. */
  labelKey?: string;
  /** Literal label (Studio fields, tenant texts). Wins over labelKey. */
  label?: string;
  type: FieldType;
  /** selection: the choices; many2one: the choices of the related model ({value: id}). */
  options?: readonly SelectionOption[];
  /** many2one: the record key holding the display name of the related record. */
  displayField?: string;
  /** Text search looks in this field. */
  searchable?: boolean;
  /** Offered in "Group by". */
  groupable?: boolean;
  /** List header can sort on it (default: every field but text). */
  sortable?: boolean;
  /** The form never edits it. */
  readonly?: boolean;
  required?: boolean;
  /** Help text under the form input (literal, Studio). */
  help?: string;
  /** Set on fields that come from Studio (record.custom_fields). */
  custom?: boolean;
}

export type ConditionOp = "eq" | "neq" | "in" | "gt" | "gte" | "lt" | "lte" | "contains" | "set" | "not_set";

export interface Condition {
  field: string;
  op: ConditionOp;
  value?: unknown;
}

/** Values the filter conditions can refer to. */
export interface FilterContext {
  userId: string | null;
  /** "Now" for date filters (injected so tests are stable). */
  now: Date;
}

export interface FilterDef {
  key: string;
  labelKey: string;
  /** Filters of the same group are OR'ed, groups are AND'ed (the usual ERP search panel rule). */
  group: string;
  conditions: (ctx: FilterContext) => Condition[];
}

/** Date grouping granularity, used for date and datetime fields. */
export type DateGranularity = "day" | "week" | "month" | "quarter" | "year";

/** "stage" or "created_at:month". */
export type GroupBySpec = string;

export interface SortSpec {
  field: string;
  dir: "asc" | "desc";
}

export type ViewType = "list" | "kanban" | "form" | "pivot" | "graph" | "calendar";

export interface ModelDef<R extends ViewRecord = ViewRecord> {
  /** Stable key, also the key of saved favourites ("crm.deals"). */
  key: string;
  table: string;
  /** Module that must be enabled for the tenant. */
  module: string;
  readPermission: string;
  writePermission?: string;
  /** PostgREST select of the list (relations as embedded resources). */
  select: string;
  /** Server order before any view sorting. */
  order: SortSpec;
  /** Rows read at most; the views say so when the cap is reached. */
  limit?: number;
  /** studio_fields.model_key, when the model has Studio custom fields (column custom_fields). */
  studioModel?: string;
  /** Raw row → flat record (custom fields are added by the data layer). */
  toRecord: (row: Record<string, unknown>) => R;
  /**
   * The module's own reads, when it already has them (same data and rules as its classic
   * screens). They run in the browser with the user's session, like the default reads, and
   * replace `select`/`order`/`limit`.
   */
  fetchAll?: () => Promise<Record<string, unknown>[]>;
  fetchOne?: (id: string) => Promise<Record<string, unknown> | null>;
}

export interface ListViewDef {
  columns: readonly string[];
  /** Columns summed in group rows and in the footer. */
  sums?: readonly string[];
}

export interface KanbanViewDef {
  /** A selection field: one column per option. */
  groupBy: string;
  title: string;
  subtitle?: string;
  /** Shown big at the bottom of the card and summed in the column header. */
  amount?: string;
  /** Extra small lines on the card. */
  fields?: readonly string[];
  /** Columns folded by default (e.g. lost). */
  folded?: readonly string[];
}

export interface FormTabDef {
  key: string;
  labelKey: string;
  fields: readonly string[];
}

export interface FormViewDef {
  /** Field shown as the record title. */
  title: string;
  /** Selection field shown as the status bar. */
  statusField?: string;
  /** Fields of the main sheet, in two columns on wide screens. */
  fields: readonly string[];
  tabs?: readonly FormTabDef[];
}

export interface PivotViewDef {
  rows: GroupBySpec;
  cols?: GroupBySpec;
  /** "__count" or a numeric field. */
  measure: string;
}

export interface GraphViewDef {
  groupBy: GroupBySpec;
  measure: string;
  type: "bar" | "line" | "pie";
}

export interface CalendarViewDef {
  dateField: string;
  /** Optional end field; without one an event lasts `defaultMinutes`. */
  endField?: string;
  title: string;
  /** Colour by the option colour of this selection field. */
  colorField?: string;
  defaultMinutes?: number;
}

export interface ViewDefinition<R extends ViewRecord = ViewRecord> {
  model: ModelDef<R>;
  /** i18n key of the screen title. */
  titleKey: string;
  fields: readonly FieldDef[];
  filters?: readonly FilterDef[];
  /** Fields (or "field:granularity") offered in Group by, in order. */
  groupBys?: readonly GroupBySpec[];
  defaultSort?: SortSpec;
  /** Views in the switcher, first = default. */
  views: readonly Exclude<ViewType, "form">[];
  list: ListViewDef;
  kanban?: KanbanViewDef;
  form: FormViewDef;
  pivot?: PivotViewDef;
  graph?: GraphViewDef;
  calendar?: CalendarViewDef;
}

export interface ViewRecord {
  id: string;
  [field: string]: unknown;
}

/** The state of the search panel, which is what a favourite saves. */
export interface SearchState {
  search: string;
  filters: string[];
  groupBy: GroupBySpec[];
  sort: SortSpec | null;
  view: Exclude<ViewType, "form">;
}
