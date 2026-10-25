/**
 * The new CRM pipeline on the view engine (prompt 21): opportunities (kanban by stage, list,
 * pivot, graph, calendar of expected closes) and leads (list first), one record = one deal.
 * Stages, teams, lost reasons and salespeople come from the tenant's CRM settings. Pure: no
 * React or Supabase, so tests load it directly.
 */
import type { FieldDef, FilterDef, ModelDef, SelectionOption, ViewDefinition, ViewRecord } from "../../../views/types";
import { lostReasonLabel, stageKind, teamLabel, weightedValue, type CrmLostReason, type CrmStage, type CrmTeam, type DealType, type Translate } from "../lib/pipeline";

export interface PipelineRecord extends ViewRecord {
  title: string;
  type: DealType;
  client_id: string | null;
  customer_name: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  company_name: string | null;
  team_id: string | null;
  stage_id: string | null;
  stage: string;
  /** open | won | lost, from the stage. */
  outcome: "open" | "won" | "lost";
  expected_value: number;
  probability: number;
  weighted_value: number;
  expected_close: string | null;
  priority: string;
  /** Comma-separated, as the form edits them. */
  tags: string;
  assigned_to: string | null;
  salesperson: string | null;
  source: string | null;
  medium: string | null;
  lost_reason_id: string | null;
  lost_note: string | null;
  notes: string | null;
  won_at: string | null;
  lost_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  last_quote: string | null;
  quote_count: number;
}

export const PIPELINE_VIEW_KEY = "crm.pipeline";
export const LEADS_VIEW_KEY = "crm.leads";

const SELECT = "*, customers(full_name, company_name), profiles!deals_assigned_to_fkey(full_name), quotations(*)";

function one(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null;
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function pipelineRecordFromRow(row: Record<string, unknown>, stages: readonly CrmStage[] = []): PipelineRecord {
  const customer = one(row.customers);
  const profile = one(row.profiles);
  const quotes = Array.isArray(row.quotations) ? (row.quotations as Record<string, unknown>[]) : [];
  const latest = [...quotes].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0];
  const stageId = (row.stage_id as string) || null;
  const stage = stageId ? stages.find((s) => s.id === stageId) : undefined;
  const expected = Number(row.expected_value) || 0;
  const probability = Number(row.probability) || 0;
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    type: row.type === "lead" ? "lead" : "opportunity",
    client_id: (row.client_id as string) || null,
    customer_name: (customer?.full_name as string) || (customer?.company_name as string) || null,
    contact_name: (row.contact_name as string) || null,
    email: (row.email as string) || null,
    phone: (row.phone as string) || null,
    company_name: (row.company_name as string) || null,
    team_id: (row.team_id as string) || null,
    stage_id: stageId,
    stage: String(row.stage ?? ""),
    outcome: stageKind(stage),
    expected_value: expected,
    probability,
    weighted_value: weightedValue({ expected_value: expected, probability }),
    expected_close: (row.expected_close as string) || null,
    priority: String(Math.min(3, Math.max(0, Number(row.priority) || 0))),
    tags: Array.isArray(row.tags) ? (row.tags as string[]).join(", ") : "",
    assigned_to: (row.assigned_to as string) || null,
    salesperson: (profile?.full_name as string) || null,
    source: (row.source as string) || null,
    medium: (row.medium as string) || null,
    lost_reason_id: (row.lost_reason_id as string) || null,
    lost_note: (row.lost_note as string) || null,
    notes: (row.notes as string) || null,
    won_at: (row.won_at as string) || null,
    lost_at: (row.lost_at as string) || null,
    created_at: (row.created_at as string) || null,
    updated_at: (row.updated_at as string) || null,
    last_quote: latest ? String(latest.quote_number ?? "") || null : null,
    quote_count: quotes.length,
  };
}

export interface PipelineContext {
  teams: readonly CrmTeam[];
  stages: readonly CrmStage[];
  lostReasons: readonly CrmLostReason[];
  customers: readonly { id: string; full_name: string; company_name: string | null }[];
  salespeople: readonly { id: string; full_name: string }[];
  t: Translate;
  /** The module's reads (browser client, user session). */
  fetchAll: (type: DealType) => Promise<Record<string, unknown>[]>;
  fetchOne: (id: string) => Promise<Record<string, unknown> | null>;
}

function model(key: string, type: DealType, ctx: PipelineContext): ModelDef<PipelineRecord> {
  return {
    key,
    table: "deals",
    module: "crm",
    readPermission: "can_view_crm",
    writePermission: "can_manage_crm",
    select: SELECT,
    order: { field: "created_at", dir: "desc" },
    toRecord: (row) => pipelineRecordFromRow(row, ctx.stages),
    fetchAll: () => ctx.fetchAll(type),
    fetchOne: (id) => ctx.fetchOne(id),
  };
}

/** Stage options: shared stages and every team's own (named with the team when there are several teams). */
export function stageOptions(ctx: Pick<PipelineContext, "stages" | "teams" | "t">): SelectionOption[] {
  const several = ctx.teams.length > 1;
  return [...ctx.stages]
    .sort((a, b) => a.sequence - b.sequence)
    .map((s) => {
      const team = s.team_id ? ctx.teams.find((x) => x.id === s.team_id) : null;
      return { value: s.id, label: team && several ? `${s.name} · ${teamLabel(team, ctx.t)}` : s.name, color: s.color };
    });
}

const PRIORITY_OPTIONS: SelectionOption[] = [0, 1, 2, 3].map((n) => ({ value: String(n), labelKey: `crm.pipeline.priority.${n}` }));

export function pipelineFields(ctx: PipelineContext): FieldDef[] {
  return [
    { name: "title", labelKey: "crm.pipeline.fields.title", type: "char", required: true, searchable: true },
    {
      name: "client_id",
      labelKey: "crm.pipeline.fields.customer",
      type: "many2one",
      displayField: "customer_name",
      options: ctx.customers.map((c) => ({ value: c.id, label: c.company_name ? `${c.full_name} (${c.company_name})` : c.full_name })),
      searchable: true,
      groupable: true,
    },
    { name: "contact_name", labelKey: "crm.pipeline.fields.contactName", type: "char", searchable: true },
    { name: "company_name", labelKey: "crm.pipeline.fields.companyName", type: "char", searchable: true },
    { name: "email", labelKey: "crm.pipeline.fields.email", type: "char", searchable: true },
    { name: "phone", labelKey: "crm.pipeline.fields.phone", type: "char", searchable: true },
    { name: "stage_id", labelKey: "crm.pipeline.fields.stage", type: "selection", options: stageOptions(ctx), groupable: true, readonly: true },
    {
      name: "team_id",
      labelKey: "crm.pipeline.fields.team",
      type: "selection",
      options: ctx.teams.map((tm) => ({ value: tm.id, label: teamLabel(tm, ctx.t) })),
      groupable: true,
    },
    {
      name: "assigned_to",
      labelKey: "crm.pipeline.fields.salesperson",
      type: "many2one",
      displayField: "salesperson",
      options: ctx.salespeople.map((p) => ({ value: p.id, label: p.full_name })),
      groupable: true,
      searchable: true,
    },
    { name: "expected_value", labelKey: "crm.pipeline.fields.expectedValue", type: "monetary" },
    { name: "probability", labelKey: "crm.pipeline.fields.probability", type: "float" },
    { name: "weighted_value", labelKey: "crm.pipeline.fields.weightedValue", type: "monetary", readonly: true },
    { name: "expected_close", labelKey: "crm.pipeline.fields.expectedClose", type: "date" },
    { name: "priority", labelKey: "crm.pipeline.fields.priority", type: "selection", options: PRIORITY_OPTIONS, groupable: true },
    { name: "tags", labelKey: "crm.pipeline.fields.tags", type: "char", searchable: true, help: ctx.t("crm.pipeline.fields.tagsHelp") },
    { name: "source", labelKey: "crm.pipeline.fields.source", type: "char", searchable: true, groupable: true },
    { name: "medium", labelKey: "crm.pipeline.fields.medium", type: "char", searchable: true, groupable: true },
    {
      name: "lost_reason_id",
      labelKey: "crm.pipeline.fields.lostReason",
      type: "selection",
      options: ctx.lostReasons.map((r) => ({ value: r.id, label: lostReasonLabel(r, ctx.t) })),
      groupable: true,
      readonly: true,
    },
    { name: "lost_note", labelKey: "crm.pipeline.fields.lostNote", type: "text", readonly: true },
    { name: "notes", labelKey: "crm.pipeline.fields.notes", type: "text", searchable: true },
    { name: "last_quote", labelKey: "crm.pipeline.fields.lastQuote", type: "char", readonly: true, searchable: true },
    { name: "created_at", labelKey: "crm.pipeline.fields.createdAt", type: "datetime", readonly: true },
    { name: "won_at", labelKey: "crm.pipeline.fields.wonAt", type: "datetime", readonly: true },
  ];
}

const monthStart = (now: Date) => new Date(now.getFullYear(), now.getMonth(), 1);
const monthEnd = (now: Date) => new Date(now.getFullYear(), now.getMonth() + 1, 0);
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function pipelineFilters(ctx: Pick<PipelineContext, "teams" | "stages" | "t">): FilterDef[] {
  const ids = (pick: (s: CrmStage) => boolean) => ctx.stages.filter(pick).map((s) => s.id);
  return [
    { key: "mine", labelKey: "crm.pipeline.filters.mine", group: "owner", conditions: (f) => [{ field: "assigned_to", op: "eq", value: f.userId ?? "__nobody" }] },
    { key: "unassigned", labelKey: "crm.pipeline.filters.unassigned", group: "owner", conditions: () => [{ field: "assigned_to", op: "not_set" }] },
    { key: "open", labelKey: "crm.pipeline.filters.open", group: "outcome", conditions: () => [{ field: "stage_id", op: "in", value: ids((s) => !s.is_won && !s.is_lost) }] },
    { key: "won", labelKey: "crm.pipeline.filters.won", group: "outcome", conditions: () => [{ field: "stage_id", op: "in", value: ids((s) => s.is_won) }] },
    { key: "lost", labelKey: "crm.pipeline.filters.lost", group: "outcome", conditions: () => [{ field: "stage_id", op: "in", value: ids((s) => s.is_lost) }] },
    { key: "hot", labelKey: "crm.pipeline.filters.hot", group: "priority", conditions: () => [{ field: "priority", op: "in", value: ["2", "3"] }] },
    {
      key: "closing_month",
      labelKey: "crm.pipeline.filters.closingThisMonth",
      group: "date",
      conditions: (f) => [
        { field: "expected_close", op: "gte", value: isoDay(monthStart(f.now)) },
        { field: "expected_close", op: "lte", value: isoDay(monthEnd(f.now)) },
      ],
    },
    { key: "overdue", labelKey: "crm.pipeline.filters.overdue", group: "date", conditions: (f) => [{ field: "expected_close", op: "lt", value: isoDay(f.now) }, { field: "outcome", op: "eq", value: "open" }] },
  ];
}

/** Opportunities: the pipeline kanban first. */
export function opportunitiesDefinition(ctx: PipelineContext): ViewDefinition<PipelineRecord> {
  return {
    model: model(PIPELINE_VIEW_KEY, "opportunity", ctx),
    titleKey: "crm.pipeline.title",
    fields: [...pipelineFields(ctx), { name: "outcome", labelKey: "crm.pipeline.fields.outcome", type: "char", readonly: true }],
    filters: pipelineFilters(ctx),
    groupBys: ["stage_id", "team_id", "assigned_to", "priority", "source", "expected_close:month", "created_at:month"],
    views: ["kanban", "list", "pivot", "graph", "calendar"],
    list: { columns: ["title", "client_id", "assigned_to", "stage_id", "expected_close", "probability", "expected_value", "weighted_value"], sums: ["expected_value", "weighted_value"] },
    kanban: {
      groupBy: "stage_id",
      title: "title",
      subtitle: "client_id",
      amount: "expected_value",
      fields: ["priority", "expected_close", "tags"],
      folded: ctx.stages.filter((s) => s.folded).map((s) => s.id),
    },
    form: {
      title: "title",
      statusField: "stage_id",
      fields: ["client_id", "expected_value", "probability", "expected_close", "assigned_to", "team_id", "priority", "tags"],
      tabs: [
        { key: "contact", labelKey: "crm.pipeline.tabs.contact", fields: ["contact_name", "company_name", "email", "phone", "source", "medium"] },
        { key: "notes", labelKey: "crm.pipeline.tabs.notes", fields: ["notes"] },
        { key: "lost", labelKey: "crm.pipeline.tabs.lost", fields: ["lost_reason_id", "lost_note"] },
      ],
    },
    pivot: { rows: "stage_id", cols: "expected_close:month", measure: "expected_value" },
    graph: { groupBy: "stage_id", measure: "expected_value", type: "bar" },
    calendar: { dateField: "expected_close", title: "title", colorField: "stage_id", defaultMinutes: 60 },
  };
}

/** Leads: not qualified yet, a list to work through, converted to opportunities. */
export function leadsDefinition(ctx: PipelineContext): ViewDefinition<PipelineRecord> {
  const filters = pipelineFilters(ctx).filter((f) => !["open", "won", "lost", "closing_month", "overdue"].includes(f.key));
  return {
    model: model(LEADS_VIEW_KEY, "lead", ctx),
    titleKey: "crm.pipeline.leadsTitle",
    fields: pipelineFields(ctx),
    filters,
    groupBys: ["source", "medium", "assigned_to", "team_id", "created_at:month"],
    views: ["list", "kanban", "pivot", "graph"],
    list: { columns: ["title", "contact_name", "company_name", "email", "phone", "source", "assigned_to", "created_at"] },
    kanban: { groupBy: "priority", title: "title", subtitle: "contact_name", fields: ["company_name", "source"] },
    form: {
      title: "title",
      fields: ["contact_name", "company_name", "email", "phone", "source", "medium", "assigned_to", "team_id", "priority", "tags", "expected_value"],
      tabs: [{ key: "notes", labelKey: "crm.pipeline.tabs.notes", fields: ["notes"] }],
    },
    pivot: { rows: "source", cols: "created_at:month", measure: "__count" },
    graph: { groupBy: "source", measure: "__count", type: "bar" },
  };
}
