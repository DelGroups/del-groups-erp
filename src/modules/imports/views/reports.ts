/**
 * Imports reports on the view engine (IMP-3): filters, group by, column chooser and Excel export
 * come with the engine. Pure: rows come from importReportsAction.
 */
import type { ModelDef, ViewDefinition, ViewRecord } from "@/views/types";
import type { PayableReportRow, ProductReportRow, ShipmentReportRow, TransitReportRow, VatReportRow } from "../lib/reports";
import { SHIPMENT_STATUSES } from "../lib/shipment";

export const IMPORT_REPORTS = ["shipments", "products", "vat", "payables", "transit"] as const;
export type ImportReportKey = (typeof IMPORT_REPORTS)[number];

const asRecord = <R extends ViewRecord>(row: Record<string, unknown>) => row as unknown as R;
const model = (key: ImportReportKey): Omit<ModelDef, "toRecord"> => ({
  key: `imports.report.${key}`,
  table: "import_shipments",
  module: "imports",
  readPermission: "can_view_imports",
  select: "*",
  order: { field: "id", dir: "asc" },
});
const status = {
  name: "status",
  labelKey: "common.status",
  type: "selection" as const,
  groupable: true,
  readonly: true,
  options: SHIPMENT_STATUSES.map((s) => ({ value: s, labelKey: `imports.status.${s}` })),
};

export type ShipmentReportRecord = ShipmentReportRow & ViewRecord;
export type ProductReportRecord = ProductReportRow & ViewRecord;
export type VatReportRecord = VatReportRow & ViewRecord;
export type PayableReportRecord = PayableReportRow & ViewRecord;
export type TransitReportRecord = TransitReportRow & ViewRecord;

export function shipmentsReportDefinition(): ViewDefinition<ShipmentReportRecord> {
  return {
    model: { ...model("shipments"), toRecord: asRecord },
    titleKey: "importReports.shipments.title",
    fields: [
      { name: "number", labelKey: "imports.fields.number", type: "char", searchable: true, readonly: true },
      status,
      { name: "supplier_name", labelKey: "imports.fields.supplier", type: "char", searchable: true, groupable: true, readonly: true },
      { name: "currency_code", labelKey: "imports.fields.currency", type: "char", groupable: true, readonly: true },
      { name: "invoice_date", labelKey: "imports.fields.invoiceDate", type: "date", readonly: true },
      { name: "goods_azn", labelKey: "imports.landed.summary_goods", type: "monetary", readonly: true },
      { name: "capitalized_azn", labelKey: "imports.landed.summary_capitalized", type: "monetary", readonly: true },
      { name: "vat_azn", labelKey: "imports.landed.summary_recoverableVat", type: "monetary", readonly: true },
      { name: "landed_azn", labelKey: "imports.landed.summary_landedTotal", type: "monetary", readonly: true },
      { name: "qty_stock", labelKey: "importReports.qtyStock", type: "float", readonly: true },
      { name: "landed_per_unit", labelKey: "importReports.landedPerUnit", type: "float", readonly: true },
    ],
    filters: [],
    groupBys: ["status", "supplier_name", "currency_code", "invoice_date:month"],
    views: ["list", "pivot", "graph"],
    list: {
      columns: ["number", "status", "supplier_name", "currency_code", "invoice_date", "goods_azn", "capitalized_azn", "vat_azn", "landed_azn", "landed_per_unit"],
      sums: ["goods_azn", "capitalized_azn", "vat_azn", "landed_azn"],
      optional: ["qty_stock"],
    },
    form: { title: "number", statusField: "status", fields: ["supplier_name", "goods_azn", "capitalized_azn", "vat_azn", "landed_azn", "landed_per_unit"] },
    pivot: { rows: "supplier_name", cols: "status", measure: "landed_azn" },
    graph: { groupBy: "supplier_name", measure: "landed_azn", type: "bar" },
  };
}

export function productsReportDefinition(): ViewDefinition<ProductReportRecord> {
  return {
    model: { ...model("products"), toRecord: asRecord },
    titleKey: "importReports.products.title",
    fields: [
      { name: "product_code", labelKey: "imports.sheet.code", type: "char", searchable: true, groupable: true, readonly: true },
      { name: "product_name", labelKey: "imports.fields.product", type: "char", searchable: true, groupable: true, readonly: true },
      { name: "supplier_name", labelKey: "imports.fields.supplier", type: "char", searchable: true, groupable: true, readonly: true },
      { name: "shipment_number", labelKey: "imports.fields.number", type: "char", searchable: true, readonly: true },
      { name: "date", labelKey: "common.date", type: "date", readonly: true },
      { name: "currency_code", labelKey: "imports.fields.currency", type: "char", groupable: true, readonly: true },
      { name: "unit_price_fc", labelKey: "imports.fields.unitPriceFc", type: "float", readonly: true },
      { name: "qty_purchase", labelKey: "imports.fields.qtyPurchase", type: "float", readonly: true },
      { name: "qty_stock", labelKey: "importReports.qtyStock", type: "float", readonly: true },
      { name: "landed_azn", labelKey: "imports.landed.total", type: "monetary", readonly: true },
      { name: "unit_cost_purchase", labelKey: "imports.landed.unitCost", type: "float", readonly: true },
      { name: "unit_cost_stock", labelKey: "imports.landed.stockUnitCost", type: "float", readonly: true },
    ],
    filters: [],
    groupBys: ["product_name", "supplier_name", "date:month", "currency_code"],
    views: ["list", "pivot", "graph"],
    list: {
      columns: ["product_code", "product_name", "supplier_name", "shipment_number", "date", "qty_stock", "landed_azn", "unit_cost_stock"],
      sums: ["landed_azn", "qty_stock"],
      optional: ["currency_code", "unit_price_fc", "qty_purchase", "unit_cost_purchase"],
    },
    form: { title: "product_name", fields: ["shipment_number", "supplier_name", "date", "qty_stock", "landed_azn", "unit_cost_stock"] },
    pivot: { rows: "product_name", cols: "supplier_name", measure: "landed_azn" },
    graph: { groupBy: "date:month", measure: "landed_azn", type: "line" },
  };
}

export function vatReportDefinition(): ViewDefinition<VatReportRecord> {
  return {
    model: { ...model("vat"), toRecord: asRecord },
    titleKey: "importReports.vat.title",
    fields: [
      { name: "month", labelKey: "importReports.month", type: "char", groupable: true, readonly: true },
      { name: "shipment_number", labelKey: "imports.fields.number", type: "char", searchable: true, readonly: true },
      { name: "supplier_name", labelKey: "imports.fields.supplier", type: "char", searchable: true, groupable: true, readonly: true },
      { name: "declaration_no", labelKey: "imports.fields.customsDeclarationNo", type: "char", searchable: true, readonly: true },
      { name: "declaration_date", labelKey: "imports.fields.customsDeclarationDate", type: "date", readonly: true },
      { name: "customs_value_azn", labelKey: "imports.landed.summary_customsValue", type: "monetary", readonly: true },
      { name: "duty_azn", labelKey: "imports.landed.summary_duty", type: "monetary", readonly: true },
      { name: "customs_vat_azn", labelKey: "importReports.customsVat", type: "monetary", readonly: true },
      { name: "local_vat_azn", labelKey: "importReports.localVat", type: "monetary", readonly: true },
      { name: "total_vat_azn", labelKey: "importReports.totalVat", type: "monetary", readonly: true },
    ],
    filters: [],
    groupBys: ["month", "supplier_name"],
    views: ["list", "pivot"],
    list: {
      columns: ["month", "declaration_no", "declaration_date", "shipment_number", "supplier_name", "customs_value_azn", "duty_azn", "customs_vat_azn", "local_vat_azn", "total_vat_azn"],
      sums: ["customs_value_azn", "duty_azn", "customs_vat_azn", "local_vat_azn", "total_vat_azn"],
    },
    form: { title: "shipment_number", fields: ["declaration_no", "declaration_date", "customs_value_azn", "duty_azn", "customs_vat_azn", "local_vat_azn"] },
    pivot: { rows: "month", cols: "supplier_name", measure: "total_vat_azn" },
  };
}

export function payablesReportDefinition(): ViewDefinition<PayableReportRecord> {
  return {
    model: { ...model("payables"), toRecord: asRecord },
    titleKey: "importReports.payables.title",
    fields: [
      { name: "partner_name", labelKey: "importPosting.payableCols.partner", type: "char", searchable: true, groupable: true, readonly: true },
      { name: "shipment_number", labelKey: "imports.fields.number", type: "char", searchable: true, readonly: true },
      {
        name: "source",
        labelKey: "importPosting.payableCols.for",
        type: "selection",
        groupable: true,
        readonly: true,
        options: [
          { value: "goods", labelKey: "importPosting.forGoods" },
          { value: "cost", labelKey: "importReports.forCost" },
        ],
      },
      { name: "document_date", labelKey: "common.date", type: "date", readonly: true },
      { name: "currency_code", labelKey: "imports.fields.currency", type: "char", groupable: true, readonly: true },
      { name: "open_fc", labelKey: "importReports.openFc", type: "float", readonly: true },
      { name: "open_azn", labelKey: "importReports.openAzn", type: "monetary", readonly: true },
      { name: "age_days", labelKey: "importReports.ageDays", type: "integer", readonly: true },
    ],
    filters: [],
    groupBys: ["partner_name", "currency_code", "source"],
    views: ["list", "pivot", "graph"],
    list: {
      columns: ["partner_name", "shipment_number", "source", "document_date", "currency_code", "open_fc", "open_azn", "age_days"],
      sums: ["open_azn"],
    },
    form: { title: "partner_name", fields: ["shipment_number", "document_date", "currency_code", "open_fc", "open_azn"] },
    pivot: { rows: "partner_name", cols: "currency_code", measure: "open_azn" },
    graph: { groupBy: "partner_name", measure: "open_azn", type: "bar" },
  };
}

export function transitReportDefinition(): ViewDefinition<TransitReportRecord> {
  return {
    model: { ...model("transit"), toRecord: asRecord },
    titleKey: "importReports.transit.title",
    fields: [
      { name: "shipment_number", labelKey: "imports.fields.number", type: "char", searchable: true, readonly: true },
      status,
      { name: "supplier_name", labelKey: "imports.fields.supplier", type: "char", searchable: true, groupable: true, readonly: true },
      { name: "balance_azn", labelKey: "importReports.transitBalance", type: "monetary", readonly: true },
      { name: "last_entry_date", labelKey: "importReports.lastEntry", type: "date", readonly: true },
    ],
    filters: [],
    groupBys: ["status", "supplier_name"],
    views: ["list"],
    list: { columns: ["shipment_number", "status", "supplier_name", "balance_azn", "last_entry_date"], sums: ["balance_azn"] },
    form: { title: "shipment_number", statusField: "status", fields: ["supplier_name", "balance_azn", "last_entry_date"] },
  };
}
