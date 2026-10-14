/**
 * CRM deals on the view engine (prompt 17): the model and the view definition. The pipeline
 * stages (labels, colours, won/lost kinds) come from the tenant's CRM settings, the customer
 * choices from the customers list. Pure: no React or Supabase, so tests load it directly.
 */
import type { CrmConfig } from "../lib/config";
import type { FilterDef, ModelDef, ViewDefinition, ViewRecord } from "../../../views/types";

export interface DealRecord extends ViewRecord {
  title: string;
  client_id: string | null;
  customer_name: string | null;
  stage: string;
  expected_value: number;
  assigned_to: string | null;
  salesperson: string | null;
  notes: string | null;
  production_order_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  /** Latest quotation number, for cards and lists. */
  last_quote: string | null;
  quote_count: number;
}

export const DEALS_VIEW_KEY = "crm.deals";

function one(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null;
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function dealFromRow(row: Record<string, unknown>): DealRecord {
  const customer = one(row.customers);
  const profile = one(row.profiles);
  const quotes = Array.isArray(row.quotations) ? (row.quotations as Record<string, unknown>[]) : [];
  const latest = [...quotes].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0];
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    client_id: (row.client_id as string) || null,
    customer_name: (customer?.full_name as string) || (customer?.company_name as string) || null,
    stage: String(row.stage || "LEAD"),
    expected_value: Number(row.expected_value) || 0,
    assigned_to: (row.assigned_to as string) || null,
    salesperson: (profile?.full_name as string) || null,
    notes: (row.notes as string) || null,
    production_order_id: (row.production_order_id as string) || null,
    created_at: (row.created_at as string) || null,
    updated_at: (row.updated_at as string) || null,
    last_quote: latest ? String(latest.quote_number ?? "") || null : null,
    quote_count: quotes.length,
  };
}

/** The deals table, read with the user's session (RLS) while the CRM module is on. */
export const DEALS_MODEL: ModelDef<DealRecord> = {
  key: DEALS_VIEW_KEY,
  table: "deals",
  module: "crm",
  readPermission: "can_view_crm",
  writePermission: "can_manage_crm",
  select: "*, customers(full_name, company_name), profiles!deals_assigned_to_fkey(full_name), quotations(*)",
  order: { field: "created_at", dir: "desc" },
  toRecord: dealFromRow,
};

const monthStart = (now: Date) => new Date(now.getFullYear(), now.getMonth(), 1);

export function dealFilters(config: CrmConfig): FilterDef[] {
  const kind = (k: string) => config.stages.filter((s) => s.kind === k).map((s) => s.id);
  const open = config.stages.filter((s) => s.kind === "open" || s.kind === "proposal").map((s) => s.id);
  return [
    { key: "mine", labelKey: "crm.engine.filters.mine", group: "owner", conditions: (ctx) => [{ field: "assigned_to", op: "eq", value: ctx.userId ?? "__nobody" }] },
    { key: "open", labelKey: "crm.engine.filters.open", group: "stage", conditions: () => [{ field: "stage", op: "in", value: open }] },
    { key: "won", labelKey: "crm.engine.filters.won", group: "stage", conditions: () => [{ field: "stage", op: "in", value: kind("won") }] },
    { key: "lost", labelKey: "crm.engine.filters.lost", group: "stage", conditions: () => [{ field: "stage", op: "in", value: kind("lost") }] },
    { key: "with_quote", labelKey: "crm.engine.filters.withQuote", group: "quote", conditions: () => [{ field: "last_quote", op: "set" }] },
    { key: "this_month", labelKey: "crm.engine.filters.thisMonth", group: "date", conditions: (ctx) => [{ field: "created_at", op: "gte", value: monthStart(ctx.now) }] },
  ];
}

/**
 * The deals screen: kanban by stage (as the classic pipeline), list, pivot, graph and a
 * calendar of creation dates; the form edits title, customer, value and notes, and moves the
 * stage from its status bar.
 */
export function dealsDefinition(config: CrmConfig, customers: readonly { id: string; full_name: string; company_name: string | null }[]): ViewDefinition<DealRecord> {
  return {
    model: DEALS_MODEL,
    titleKey: "crm.engine.title",
    fields: [
      { name: "title", labelKey: "crm.deal.title", type: "char", required: true, searchable: true },
      {
        name: "client_id",
        labelKey: "crm.deal.client",
        type: "many2one",
        displayField: "customer_name",
        options: customers.map((c) => ({ value: c.id, label: c.company_name ? `${c.full_name} (${c.company_name})` : c.full_name })),
        searchable: true,
        groupable: true,
      },
      { name: "stage", labelKey: "crm.engine.fields.stage", type: "selection", options: config.stages.map((s) => ({ value: s.id, label: s.label, color: s.color })), groupable: true, readonly: true },
      { name: "expected_value", labelKey: "crm.deal.expectedValue", type: "monetary" },
      { name: "assigned_to", labelKey: "crm.engine.fields.salesperson", type: "many2one", displayField: "salesperson", readonly: true, groupable: true, searchable: true },
      { name: "notes", labelKey: "crm.engine.fields.notes", type: "text", searchable: true },
      { name: "last_quote", labelKey: "crm.engine.fields.lastQuote", type: "char", readonly: true, searchable: true },
      { name: "created_at", labelKey: "crm.engine.fields.createdAt", type: "datetime", readonly: true },
      { name: "updated_at", labelKey: "crm.engine.fields.updatedAt", type: "datetime", readonly: true },
    ],
    filters: dealFilters(config),
    groupBys: ["stage", "client_id", "assigned_to", "created_at:month", "created_at:quarter"],
    views: ["kanban", "list", "pivot", "graph", "calendar"],
    list: { columns: ["title", "client_id", "assigned_to", "stage", "last_quote", "expected_value", "created_at"], sums: ["expected_value"] },
    kanban: {
      groupBy: "stage",
      title: "title",
      subtitle: "client_id",
      amount: "expected_value",
      fields: ["last_quote"],
      folded: config.stages.filter((s) => s.kind === "lost").map((s) => s.id),
    },
    form: {
      title: "title",
      statusField: "stage",
      fields: ["client_id", "expected_value", "assigned_to", "last_quote"],
      tabs: [{ key: "notes", labelKey: "crm.engine.fields.notes", fields: ["notes"] }],
    },
    pivot: { rows: "stage", cols: "created_at:month", measure: "expected_value" },
    graph: { groupBy: "stage", measure: "expected_value", type: "bar" },
    calendar: { dateField: "created_at", title: "title", colorField: "stage", defaultMinutes: 45 },
  };
}
