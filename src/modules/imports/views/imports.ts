/**
 * Import shipments on the view engine (IMP-1): the list with status, supplier, currency, totals,
 * creator and dates, and the dashboard cards. Pure: rows come from listShipmentsAction.
 */
import { countIf, figure, money, sumIf, type Formatter } from "@/views/logic";
import type { Kpi } from "@/views/components/KpiCards";
import type { ModelDef, ViewDefinition, ViewRecord } from "@/views/types";
import { SHIPMENT_STATUSES, type ShipmentStatus } from "../lib/shipment";

export const IMPORTS_VIEW_KEY = "imports.shipments";

export interface ShipmentRecord extends ViewRecord {
  number: string;
  status: ShipmentStatus;
  supplier_id: string | null;
  supplier_name: string | null;
  currency_code: string;
  invoice_no: string | null;
  invoice_date: string | null;
  customs_declaration_date: string | null;
  line_count: number;
  goods_fc: number | null;
  goods_azn: number | null;
  costs_azn: number | null;
  landed_azn: number | null;
  vat_azn: number | null;
  created_at: string | null;
  updated_at: string | null;
  created_by_name: string | null;
}

const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

export function shipmentToRecord(row: Record<string, unknown>): ShipmentRecord {
  const status = typeof row.status === "string" && (SHIPMENT_STATUSES as readonly string[]).includes(row.status) ? (row.status as ShipmentStatus) : "draft";
  return {
    id: String(row.id),
    number: String(row.number ?? ""),
    status,
    supplier_id: str(row.supplier_id),
    supplier_name: str(row.supplier_name),
    currency_code: String(row.currency_code ?? ""),
    invoice_no: str(row.invoice_no),
    invoice_date: str(row.invoice_date),
    customs_declaration_date: str(row.customs_declaration_date),
    line_count: num(row.line_count) ?? 0,
    goods_fc: num(row.goods_fc),
    goods_azn: num(row.goods_azn),
    costs_azn: num(row.costs_azn),
    landed_azn: num(row.landed_azn),
    vat_azn: num(row.vat_azn),
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
    created_by_name: str(row.created_by_name),
  };
}

const STATUS_COLORS: Record<ShipmentStatus, string> = {
  draft: "#64748b",
  confirmed: "#0ea5e9",
  cleared: "#8b5cf6",
  partially_received: "#f59e0b",
  received: "#10b981",
  closed: "#334155",
  cancelled: "#f43f5e",
};

export function importsDefinition(fetchers: Pick<ModelDef, "fetchAll" | "fetchOne">): ViewDefinition<ShipmentRecord> {
  return {
    model: {
      key: IMPORTS_VIEW_KEY,
      table: "import_shipments",
      module: "imports",
      readPermission: "can_view_imports",
      writePermission: "can_manage_imports",
      select: "*",
      order: { field: "created_at", dir: "desc" },
      toRecord: shipmentToRecord,
      ...fetchers,
    },
    titleKey: "imports.title",
    fields: [
      { name: "number", labelKey: "imports.fields.number", type: "char", searchable: true, readonly: true },
      { name: "status", labelKey: "common.status", type: "selection", groupable: true, readonly: true, options: SHIPMENT_STATUSES.map((s) => ({ value: s, labelKey: `imports.status.${s}`, color: STATUS_COLORS[s] })) },
      { name: "supplier_id", labelKey: "imports.fields.supplier", type: "many2one", displayField: "supplier_name", searchable: true, groupable: true, readonly: true },
      { name: "currency_code", labelKey: "imports.fields.currency", type: "char", groupable: true, readonly: true },
      { name: "invoice_no", labelKey: "imports.fields.invoiceNo", type: "char", searchable: true, readonly: true },
      { name: "invoice_date", labelKey: "imports.fields.invoiceDate", type: "date", readonly: true },
      { name: "customs_declaration_date", labelKey: "imports.fields.customsDeclarationDate", type: "date", readonly: true },
      { name: "line_count", labelKey: "imports.fields.lineCount", type: "integer", readonly: true },
      { name: "goods_fc", labelKey: "imports.fields.goodsFc", type: "float", readonly: true },
      { name: "goods_azn", labelKey: "imports.fields.goodsAzn", type: "monetary", readonly: true },
      { name: "costs_azn", labelKey: "imports.fields.costsAzn", type: "monetary", readonly: true },
      { name: "landed_azn", labelKey: "imports.fields.landedAzn", type: "monetary", readonly: true },
      { name: "vat_azn", labelKey: "imports.fields.vatAzn", type: "monetary", readonly: true },
      { name: "created_at", labelKey: "sales.engine.fields.createdAt", type: "datetime", readonly: true },
      { name: "updated_at", labelKey: "imports.fields.updatedAt", type: "datetime", readonly: true },
      { name: "created_by_name", labelKey: "listColumns.createdBy", type: "char", searchable: true, groupable: true, readonly: true },
    ],
    filters: [
      ...SHIPMENT_STATUSES.map((s) => ({ key: s, labelKey: `imports.status.${s}`, group: "status", conditions: () => [{ field: "status", op: "eq" as const, value: s }] })),
      {
        key: "open",
        labelKey: "imports.filters.open",
        group: "open",
        conditions: () => [{ field: "status", op: "in" as const, value: ["draft", "confirmed", "cleared", "partially_received"] }],
      },
    ],
    groupBys: ["status", "supplier_id", "currency_code", "invoice_date:month"],
    views: ["list", "kanban", "pivot", "graph"],
    list: {
      columns: ["number", "status", "supplier_id", "currency_code", "invoice_no", "invoice_date", "goods_fc", "goods_azn", "costs_azn", "landed_azn", "created_by_name", "created_at"],
      sums: ["goods_azn", "costs_azn", "landed_azn", "vat_azn"],
      standard: ["created_at", "created_by_name"],
      optional: ["customs_declaration_date", "line_count", "vat_azn", "updated_at"],
      standardLabels: { invoice_date: "listColumns.documentDate", created_at: "listColumns.issuedAt", created_by_name: "listColumns.createdBy" },
    },
    kanban: { groupBy: "status", title: "number", subtitle: "supplier_id", amount: "landed_azn", fields: ["invoice_no", "invoice_date"] },
    form: { title: "number", statusField: "status", fields: ["supplier_id", "currency_code", "invoice_no", "invoice_date", "goods_azn", "landed_azn"] },
    pivot: { rows: "supplier_id", cols: "status", measure: "landed_azn" },
    graph: { groupBy: "supplier_id", measure: "landed_azn", type: "bar" },
  };
}

/** Open shipments, goods value and landed cost of the open ones, and drafts. */
export function importKpis(records: readonly ShipmentRecord[], fmt: Formatter): Kpi[] {
  const open = records.filter((r) => r.status !== "closed" && r.status !== "cancelled");
  const hasMoney = records.some((r) => r.landed_azn !== null);
  return [
    { key: "open", label: fmt.t("imports.kpi.open"), value: figure(open.length, fmt), hint: fmt.t("imports.kpi.openHint"), filters: ["open"], filterLabel: fmt.t("imports.kpi.showOpen") },
    { key: "drafts", label: fmt.t("imports.kpi.drafts"), value: figure(countIf(records, (r) => r.status === "draft"), fmt), filters: ["draft"], filterLabel: fmt.t("imports.kpi.showDrafts") },
    ...(hasMoney
      ? [
          { key: "goods", label: fmt.t("imports.kpi.goodsOpen"), value: money(sumIf(open, (r) => r.goods_azn ?? 0), fmt, 2), hint: fmt.t("imports.kpi.goodsOpenHint") },
          { key: "landed", label: fmt.t("imports.kpi.landedOpen"), value: money(sumIf(open, (r) => r.landed_azn ?? 0), fmt, 2), hint: fmt.t("imports.kpi.landedOpenHint") },
        ]
      : []),
  ];
}
