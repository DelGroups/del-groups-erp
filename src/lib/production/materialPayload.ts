/** @deprecated Import from `@/lib/production/payloads` instead. */
export {
  buildProductionMaterialInsertPayload,
  buildProductionExpenseInsertPayload,
  buildProductionOutsourcingInsertPayload,
  formatProductionDbError,
  isProductionSchemaColumnError,
  PRODUCTION_MATERIAL_EXTENDED_COLUMNS,
  PRODUCTION_MATERIAL_INSERT_KEYS,
  PRODUCTION_MATERIAL_LIVE_COLUMNS,
} from "@/lib/production/payloads";

export const PRODUCTION_MATERIAL_STRICT_INSERT_COLUMNS = [
  "production_order_id",
  "product_id",
  "warehouse_id",
  "quantity",
  "unit",
  "unit_price",
  "total_price",
  "notes",
] as const;
