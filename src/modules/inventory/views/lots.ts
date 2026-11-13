/**
 * LOT-4: the lot list on the view engine (search, filters, columns, saved views, Excel export).
 * Pure: rows come from listLotsAction and are shaped by lotToListRecord. The warehouse filters
 * are built from the warehouse list (a lot can sit in several warehouses: `wh:<id>` balances).
 */
import { figure, type Formatter } from "../../../views/logic";
import type { Kpi } from "../../../views/components/KpiCards";
import type { FilterDef, ModelDef, ViewDefinition, ViewRecord } from "../../../views/types";
import { EXPIRY_WINDOWS, expiryWindowConditions, LOT_ORIGINS, LOT_STATUSES, lotToListRecord, type LotListRecord } from "../lib/lotScreens";

export const LOTS_VIEW_KEY = "inventory.lots";

export type LotRecord = LotListRecord & ViewRecord;

const STATUS_COLORS = { active: "#10b981", quarantine: "#f59e0b", closed: "#64748b" } as const;

/** Filters of the list: status, expiry window, stock, and one per warehouse (lot has stock there). */
export function lotFilters(warehouses: readonly { id: string; name: string }[]): FilterDef[] {
  return [
    ...LOT_STATUSES.map((s) => ({ key: s, labelKey: `lots.screens.status.${s}`, group: "status", conditions: () => [{ field: "status", op: "eq" as const, value: s }] })),
    ...EXPIRY_WINDOWS.map((w) => ({ key: w.key, labelKey: `lots.screens.filters.${w.key}`, group: "expiry", conditions: () => expiryWindowConditions(w.key) })),
    { key: "has_stock", labelKey: "lots.screens.filters.hasStock", group: "stock", conditions: () => [{ field: "has_stock", op: "eq" as const, value: "yes" }] },
    { key: "no_stock", labelKey: "lots.screens.filters.noStock", group: "stock", conditions: () => [{ field: "has_stock", op: "not_set" as const }] },
    ...warehouses.map((w) => ({
      key: `wh:${w.id}`,
      // A warehouse name is data, not a translation key: the engine shows unknown keys as they are.
      labelKey: w.name,
      group: "warehouse",
      conditions: () => [{ field: `wh:${w.id}`, op: "gt" as const, value: 0.0005 }],
    })),
  ];
}

export function lotsDefinition(
  fetchers: Pick<ModelDef, "fetchAll" | "fetchOne">,
  opts: { key?: string; today: () => string; warehouses: readonly { id: string; name: string }[]; warehouseNames: ReadonlyMap<string, string> },
): ViewDefinition<LotRecord> {
  return {
    model: {
      key: opts.key ?? LOTS_VIEW_KEY,
      table: "stock_lots",
      module: "inventory",
      readPermission: "can_view_lots",
      writePermission: "can_manage_lots",
      select: "*",
      order: { field: "created_at", dir: "desc" },
      toRecord: (row) => lotToListRecord(row, { today: opts.today(), warehouseNames: opts.warehouseNames, supplierNames: undefined, shipmentNumbers: undefined }) as LotRecord,
      ...fetchers,
    },
    titleKey: "lots.screens.title",
    fields: [
      { name: "lot_no", labelKey: "lots.fields.lotNo", type: "char", searchable: true, readonly: true },
      { name: "supplier_batch_no", labelKey: "lots.fields.supplierBatchNo", type: "char", searchable: true, readonly: true },
      { name: "product_id", labelKey: "lots.screens.fields.product", type: "many2one", displayField: "product_name", searchable: true, groupable: true, readonly: true },
      { name: "product_code", labelKey: "lots.screens.fields.productCode", type: "char", searchable: true, readonly: true },
      { name: "product_barcode", labelKey: "lots.screens.fields.barcode", type: "char", searchable: true, readonly: true },
      {
        name: "status",
        labelKey: "common.status",
        type: "selection",
        groupable: true,
        readonly: true,
        options: LOT_STATUSES.map((s) => ({ value: s, labelKey: `lots.screens.status.${s}`, color: STATUS_COLORS[s] })),
      },
      { name: "origin_type", labelKey: "lots.screens.fields.origin", type: "selection", groupable: true, readonly: true, options: LOT_ORIGINS.map((o) => ({ value: o, labelKey: `lots.screens.origin.${o}` })) },
      { name: "origin_doc_no", labelKey: "lots.screens.fields.originDoc", type: "char", searchable: true, readonly: true },
      { name: "supplier_id", labelKey: "lots.screens.fields.supplier", type: "many2one", displayField: "supplier_name", searchable: true, groupable: true, readonly: true },
      { name: "import_shipment_id", labelKey: "lots.screens.fields.importShipment", type: "many2one", displayField: "import_shipment_no", searchable: true, groupable: true, readonly: true },
      { name: "customs_declaration_no", labelKey: "lots.screens.fields.customsNo", type: "char", searchable: true, readonly: true },
      { name: "mfg_date", labelKey: "lots.fields.mfgDate", type: "date", readonly: true },
      { name: "exp_date", labelKey: "lots.fields.expDate", type: "date", readonly: true },
      { name: "days_left", labelKey: "lots.screens.fields.daysLeft", type: "integer", readonly: true },
      {
        name: "expiry_state",
        labelKey: "lots.screens.fields.expiry",
        type: "selection",
        readonly: true,
        options: [
          { value: "expired", labelKey: "lots.picker.expired", color: "#e11d48" },
          { value: "near", labelKey: "lots.picker.nearExpiry", color: "#f59e0b" },
        ],
      },
      { name: "received_date", labelKey: "lots.screens.fields.receivedDate", type: "date", readonly: true },
      { name: "qty_received", labelKey: "lots.screens.fields.qtyReceived", type: "float", readonly: true },
      { name: "on_hand", labelKey: "lots.screens.fields.onHand", type: "float", readonly: true },
      { name: "unit", labelKey: "lots.screens.fields.unit", type: "char", readonly: true },
      { name: "warehouses", labelKey: "lots.screens.fields.warehouses", type: "char", searchable: true, readonly: true },
      { name: "has_stock", labelKey: "lots.screens.fields.hasStock", type: "char", readonly: true, internal: true },
      { name: "created_at", labelKey: "sales.engine.fields.createdAt", type: "datetime", readonly: true },
    ],
    filters: lotFilters(opts.warehouses),
    valueFilters: [
      { field: "product_id", labelField: "product_name", labelKey: "lots.screens.fields.product" },
      { field: "supplier_id", labelField: "supplier_name", labelKey: "lots.screens.fields.supplier" },
      { field: "import_shipment_id", labelField: "import_shipment_no", labelKey: "lots.screens.fields.importShipment" },
    ],
    groupBys: ["product_id", "status", "origin_type", "supplier_id", "import_shipment_id", "exp_date:month", "received_date:month"],
    defaultSort: { field: "created_at", dir: "desc" },
    views: ["list", "pivot"],
    list: {
      columns: ["lot_no", "product_id", "supplier_batch_no", "status", "expiry_state", "exp_date", "days_left", "on_hand", "unit", "warehouses", "received_date", "supplier_id"],
      sums: ["on_hand", "qty_received"],
      optional: ["product_code", "product_barcode", "origin_type", "origin_doc_no", "import_shipment_id", "customs_declaration_no", "mfg_date", "qty_received", "created_at"],
    },
    form: { title: "lot_no", statusField: "status", fields: ["product_id", "supplier_batch_no", "exp_date", "on_hand", "warehouses"] },
    pivot: { rows: "product_id", cols: "status", measure: "on_hand" },
  };
}

/** Lots with stock, expired with stock, expiring within 30 days with stock, in quarantine. */
export function lotKpiCards(records: readonly LotRecord[], fmt: Formatter): Kpi[] {
  const withStock = records.filter((r) => r.has_stock === "yes");
  const expired = withStock.filter((r) => r.expiry_state === "expired").length;
  const soon = withStock.filter((r) => r.days_left !== null && r.days_left >= 0 && r.days_left <= 30).length;
  const quarantine = records.filter((r) => r.status === "quarantine").length;
  return [
    { key: "stock", label: fmt.t("lots.screens.kpi.withStock"), value: figure(withStock.length, fmt), filters: ["has_stock"], filterLabel: fmt.t("lots.screens.kpi.showWithStock") },
    { key: "expired", label: fmt.t("lots.screens.kpi.expired"), value: figure(expired, fmt), filters: ["expired", "has_stock"], filterLabel: fmt.t("lots.screens.kpi.showExpired"), tone: expired ? "attention" : undefined },
    { key: "soon", label: fmt.t("lots.screens.kpi.soon"), value: figure(soon, fmt), filters: ["exp30", "has_stock"], filterLabel: fmt.t("lots.screens.kpi.showSoon"), tone: soon ? "attention" : undefined },
    { key: "quarantine", label: fmt.t("lots.screens.kpi.quarantine"), value: figure(quarantine, fmt), filters: ["quarantine"], filterLabel: fmt.t("lots.screens.kpi.showQuarantine") },
  ];
}
