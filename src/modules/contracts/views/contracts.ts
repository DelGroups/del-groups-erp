/**
 * Contracts on the view engine (NEW_UI): the contract record, its view definition and the
 * dashboard cards (the classic stats plus contracts expiring soon). Pure: rows come from the
 * module's own fetchContracts (same data as the classic page).
 */
import { countIf, figure, money, sumIf, type Formatter } from "../../../views/logic";
import type { Kpi } from "../../../views/components/KpiCards";
import type { ModelDef, ViewDefinition, ViewRecord } from "../../../views/types";

export const CONTRACTS_VIEW_KEY = "contracts.list";
export const EXPIRING_DAYS = 30;

export interface ContractRecord extends ViewRecord {
  contract_number: string;
  title: string;
  party_id: string | null;
  party_name: string | null;
  type: "sale" | "purchase" | "service";
  status: "active" | "completed" | "cancelled";
  total_amount: number | null;
  advance_percentage: number | null;
  advance_amount: number | null;
  payment_stages: number | null;
  voen: string | null;
  contract_date: string | null;
  expiry_date: string | null;
  has_attachment: boolean;
  payment_terms_notes: string | null;
  created_at: string | null;
  /** Prompt 24c. */
  created_by_name: string | null;
}

const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

export function contractToRecord(row: Record<string, unknown>): ContractRecord {
  const total = num(row.total_amount);
  const advance = num(row.advance_percentage);
  return {
    id: String(row.id),
    contract_number: String(row.contract_number ?? ""),
    title: String(row.title ?? ""),
    party_id: str(row.party_id),
    party_name: str(row.party_name),
    type: row.type === "purchase" || row.type === "service" ? row.type : "sale",
    status: row.status === "completed" || row.status === "cancelled" ? row.status : "active",
    total_amount: total,
    advance_percentage: advance,
    // As the classic "expected advance": amount × advance %.
    advance_amount: total != null && advance != null && advance > 0 ? Math.round(total * advance) / 100 : null,
    payment_stages: num(row.payment_stages),
    voen: str(row.voen),
    contract_date: str(row.contract_date),
    expiry_date: str(row.expiry_date),
    has_attachment: !!str(row.attachment_path),
    payment_terms_notes: str(row.payment_terms_notes),
    created_at: str(row.created_at),
    created_by_name: str(row.created_by_name),
  };
}

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export function contractsDefinition(fetchers: Pick<ModelDef, "fetchAll" | "fetchOne">): ViewDefinition<ContractRecord> {
  return {
    model: { key: CONTRACTS_VIEW_KEY, table: "contracts", module: "contracts", readPermission: "can_view_sales", select: "*", order: { field: "created_at", dir: "desc" }, toRecord: contractToRecord, ...fetchers },
    titleKey: "official.contractsPageTitle",
    fields: [
      { name: "contract_number", labelKey: "official.contractNumber", type: "char", searchable: true, readonly: true },
      { name: "title", labelKey: "official.contractTitle", type: "char", searchable: true, readonly: true },
      { name: "party_id", labelKey: "official.party", type: "many2one", displayField: "party_name", searchable: true, groupable: true, readonly: true },
      {
        name: "type",
        labelKey: "official.contractType",
        type: "selection",
        groupable: true,
        readonly: true,
        options: [
          { value: "sale", labelKey: "official.typeSale", color: "#10b981" },
          { value: "purchase", labelKey: "official.typePurchase", color: "#0ea5e9" },
          { value: "service", labelKey: "official.typeService", color: "#8b5cf6" },
        ],
      },
      {
        name: "status",
        labelKey: "common.status",
        type: "selection",
        groupable: true,
        readonly: true,
        options: [
          { value: "active", labelKey: "official.statusActive", color: "#10b981" },
          { value: "completed", labelKey: "official.statusCompleted", color: "#64748b" },
          { value: "cancelled", labelKey: "official.statusCancelled", color: "#f43f5e" },
        ],
      },
      { name: "total_amount", labelKey: "official.contractAmount", type: "monetary", readonly: true },
      { name: "advance_percentage", labelKey: "official.advancePercentage", type: "float", readonly: true },
      { name: "advance_amount", labelKey: "contracts.engine.advanceAmount", type: "monetary", readonly: true },
      { name: "payment_stages", labelKey: "official.paymentStages", type: "integer", readonly: true },
      { name: "voen", labelKey: "contracts.engine.voen", type: "char", searchable: true, readonly: true },
      { name: "contract_date", labelKey: "official.contractDate", type: "date", readonly: true },
      { name: "expiry_date", labelKey: "official.expiryDate", type: "date", readonly: true },
      { name: "has_attachment", labelKey: "contracts.engine.hasAttachment", type: "boolean", groupable: true, readonly: true },
      { name: "payment_terms_notes", labelKey: "official.paymentTermsNotes", type: "text", searchable: true, readonly: true },
      { name: "created_at", labelKey: "sales.engine.fields.createdAt", type: "datetime", readonly: true },
      { name: "created_by_name", labelKey: "listColumns.createdBy", type: "char", searchable: true, groupable: true, readonly: true },
    ],
    filters: [
      { key: "active", labelKey: "official.statusActive", group: "status", conditions: () => [{ field: "status", op: "eq", value: "active" }] },
      { key: "completed", labelKey: "official.statusCompleted", group: "status", conditions: () => [{ field: "status", op: "eq", value: "completed" }] },
      { key: "cancelled", labelKey: "official.statusCancelled", group: "status", conditions: () => [{ field: "status", op: "eq", value: "cancelled" }] },
      { key: "sale", labelKey: "official.typeSale", group: "type", conditions: () => [{ field: "type", op: "eq", value: "sale" }] },
      { key: "purchase", labelKey: "official.typePurchase", group: "type", conditions: () => [{ field: "type", op: "eq", value: "purchase" }] },
      { key: "service", labelKey: "official.typeService", group: "type", conditions: () => [{ field: "type", op: "eq", value: "service" }] },
      {
        key: "expiring",
        labelKey: "contracts.engine.expiring",
        group: "expiry",
        conditions: (ctx) => [
          { field: "status", op: "eq", value: "active" },
          { field: "expiry_date", op: "gte", value: dayStart(ctx.now) },
          { field: "expiry_date", op: "lt", value: addDays(dayStart(ctx.now), EXPIRING_DAYS + 1) },
        ],
      },
      { key: "expired", labelKey: "contracts.engine.expired", group: "expiry", conditions: (ctx) => [{ field: "status", op: "eq", value: "active" }, { field: "expiry_date", op: "lt", value: dayStart(ctx.now) }] },
      { key: "no_attachment", labelKey: "contracts.engine.noAttachment", group: "attachment", conditions: () => [{ field: "has_attachment", op: "eq", value: false }] },
    ],
    groupBys: ["status", "type", "party_id", "has_attachment", "contract_date:month", "expiry_date:month"],
    views: ["list", "kanban", "pivot", "graph", "calendar"],
    list: {
      columns: ["contract_number", "title", "party_id", "type", "total_amount", "advance_percentage", "contract_date", "expiry_date", "status"],
      sums: ["total_amount", "advance_amount"],
      // Prompt 24c: contracts have no salesperson.
      standard: ["created_at", "created_by_name"],
      optional: ["advance_amount", "payment_stages", "voen", "has_attachment", "payment_terms_notes"],
      standardLabels: { contract_date: "listColumns.documentDate", created_at: "listColumns.issuedAt", created_by_name: "listColumns.createdBy" },
    },
    kanban: { groupBy: "status", title: "title", subtitle: "party_id", amount: "total_amount", fields: ["contract_number", "expiry_date"] },
    form: {
      title: "title",
      statusField: "status",
      fields: ["contract_number", "party_id", "type", "voen", "total_amount", "advance_percentage", "advance_amount", "payment_stages", "contract_date", "expiry_date"],
      tabs: [{ key: "terms", labelKey: "official.paymentTerms", fields: ["payment_terms_notes", "has_attachment"] }],
    },
    pivot: { rows: "party_id", cols: "type", measure: "total_amount" },
    graph: { groupBy: "type", measure: "total_amount", type: "pie" },
    calendar: { dateField: "expiry_date", title: "title", colorField: "status" },
  };
}

/** The classic stat cards (active, sale/purchase, expected advance) plus contracts expiring soon. */
export function contractKpis(records: readonly ContractRecord[], fmt: Formatter, now: Date): Kpi[] {
  const active = records.filter((r) => r.status === "active");
  const today = dayStart(now);
  const limit = addDays(today, EXPIRING_DAYS + 1);
  const expiry = (r: ContractRecord) => (r.expiry_date ? new Date(`${r.expiry_date.slice(0, 10)}T00:00:00`) : null);
  const expiring = countIf(active, (r) => {
    const d = expiry(r);
    return !!d && d >= today && d < limit;
  });
  const expired = countIf(active, (r) => {
    const d = expiry(r);
    return !!d && d < today;
  });
  return [
    { key: "active", label: fmt.t("official.kpiActiveContracts"), value: figure(active.length, fmt), hint: fmt.t("official.kpiActiveContractsHint"), filters: ["active"], filterLabel: fmt.t("contracts.engine.showActive") },
    {
      key: "split",
      label: fmt.t("official.kpiSaleVsPurchase"),
      value: `${figure(countIf(records, (r) => r.type !== "purchase"), fmt)} / ${figure(countIf(records, (r) => r.type === "purchase"), fmt)}`,
      hint: fmt.t("official.kpiSaleVsPurchaseHint"),
    },
    { key: "advance", label: fmt.t("official.kpiTotalAdvance"), value: money(sumIf(active, (r) => r.advance_amount ?? 0), fmt, 2), hint: fmt.t("official.kpiTotalAdvanceHint") },
    {
      key: "expiring",
      label: fmt.t("contracts.engine.expiringSoon", { days: EXPIRING_DAYS }),
      value: figure(expiring, fmt),
      hint: fmt.t("contracts.engine.expiredHint", { count: expired }),
      filters: ["expiring"],
      filterLabel: fmt.t("contracts.engine.showExpiring"),
      tone: expiring ? "attention" : undefined,
    },
  ];
}
