/**
 * Commissions on the view engine (NEW_UI): pending sales commissions per seller, with the
 * classic cards. Pure: rows come from the module's fetchPendingCommissions and the employee
 * list (for the department), as on the classic page.
 */
import { countIf, figure, money, sumIf, type Formatter } from "../../../views/logic";
import type { Kpi } from "../../../views/components/KpiCards";
import type { ModelDef, ViewDefinition, ViewRecord } from "../../../views/types";

export const COMMISSIONS_VIEW_KEY = "commissions.pending";

export interface CommissionRecord extends ViewRecord {
  sale_id: string | null;
  sale_doc_no: string | null;
  /** Seller key as the classic list groups it: employee, else seller name. */
  seller_key: string;
  seller_name: string | null;
  department: string | null;
  product_category: string | null;
  product_name: string | null;
  sale_amount: number;
  commission_rate: number;
  commission_amount: number;
  created_at: string | null;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/**
 * A pending commission with its seller, named like the classic list: the employee's name and
 * department when linked, else the seller name on the sale (department "general").
 */
export function commissionToRecord(row: Record<string, unknown>, employees: ReadonlyMap<string, { full_name: string; department: string | null }> = new Map()): CommissionRecord {
  const employeeId = str(row.employee_id);
  const employee = employeeId ? employees.get(employeeId) : undefined;
  return {
    id: String(row.id),
    sale_id: str(row.sale_id),
    sale_doc_no: str(row.sale_doc_no),
    seller_key: employeeId ?? str(row.seller_name) ?? "unknown",
    seller_name: employee?.full_name ?? str(row.seller_name),
    department: employee ? employee.department : str(row.seller_name) ? "general" : null,
    product_category: str(row.product_category),
    product_name: str(row.product_name),
    sale_amount: num(row.sale_amount),
    commission_rate: num(row.commission_rate),
    commission_amount: num(row.commission_amount),
    created_at: str(row.created_at),
  };
}

export function commissionsDefinition(fetchers: Pick<ModelDef, "fetchAll" | "fetchOne">, departmentOptions: readonly { value: string; label: string }[] = []): ViewDefinition<CommissionRecord> {
  return {
    model: { key: COMMISSIONS_VIEW_KEY, table: "sales_commissions", module: "commissions", readPermission: "can_view_commissions", select: "*", order: { field: "created_at", dir: "desc" }, toRecord: (r) => r as CommissionRecord, ...fetchers },
    titleKey: "commissions.pageTitle",
    fields: [
      { name: "sale_doc_no", labelKey: "commissions.invoiceCol", type: "char", searchable: true, readonly: true },
      { name: "seller_key", labelKey: "commissions.engine.seller", type: "many2one", displayField: "seller_name", searchable: true, groupable: true, readonly: true },
      { name: "department", labelKey: "commissions.engine.department", type: "selection", options: departmentOptions.map((o) => ({ ...o })), groupable: true, readonly: true },
      { name: "product_category", labelKey: "commissions.productCategoryCol", type: "char", searchable: true, groupable: true, readonly: true },
      { name: "product_name", labelKey: "dashboard.product", type: "char", searchable: true, readonly: true },
      { name: "sale_amount", labelKey: "commissions.saleAmountCol", type: "monetary", readonly: true },
      { name: "commission_rate", labelKey: "commissions.rateCol", type: "float", readonly: true },
      { name: "commission_amount", labelKey: "commissions.commissionCol", type: "monetary", readonly: true },
      { name: "created_at", labelKey: "sales.engine.fields.createdAt", type: "datetime", readonly: true },
    ],
    filters: [{ key: "this_month", labelKey: "sales.engine.filters.thisMonth", group: "date", conditions: (ctx) => [{ field: "created_at", op: "gte", value: new Date(ctx.now.getFullYear(), ctx.now.getMonth(), 1) }] }],
    groupBys: ["seller_key", "department", "product_category", "created_at:month"],
    views: ["list", "pivot", "graph"],
    list: { columns: ["sale_doc_no", "seller_key", "product_category", "product_name", "sale_amount", "commission_rate", "commission_amount", "created_at"], sums: ["sale_amount", "commission_amount"] },
    form: { title: "sale_doc_no", fields: ["seller_key", "department", "product_category", "product_name", "sale_amount", "commission_rate", "commission_amount", "created_at"] },
    pivot: { rows: "seller_key", cols: "product_category", measure: "commission_amount" },
    graph: { groupBy: "seller_key", measure: "commission_amount", type: "bar" },
  };
}

/** The classic cards: pending rows, pending total, sellers; plus this month's commissions. */
export function commissionKpis(records: readonly CommissionRecord[], fmt: Formatter, now: Date): Kpi[] {
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  return [
    { key: "rows", label: fmt.t("commissions.pendingRows"), value: figure(records.length, fmt) },
    { key: "total", label: fmt.t("commissions.pendingTotal"), value: money(sumIf(records, (r) => r.commission_amount), fmt, 2), tone: "good" },
    { key: "sellers", label: fmt.t("commissions.sellerCount"), value: figure(new Set(records.map((r) => r.seller_key)).size, fmt) },
    {
      key: "month",
      label: fmt.t("commissions.engine.thisMonth"),
      value: money(sumIf(records, (r) => r.commission_amount, (r) => !!r.created_at && new Date(r.created_at) >= month), fmt, 2),
      hint: fmt.t("commissions.engine.thisMonthHint", { count: countIf(records, (r) => !!r.created_at && new Date(r.created_at) >= month) }),
      filters: ["this_month"],
      filterLabel: fmt.t("commissions.engine.showThisMonth"),
    },
  ];
}
