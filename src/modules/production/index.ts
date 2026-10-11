/**
 * Public API of the production module. Other code imports production only from
 * here (`@/modules/production`), never from its components/, lib/ or actions/.
 *
 * - CRM turns a won quotation into a production order.
 * - Backup/restore reads and writes production orders and materials.
 * - Purchase requisitions and the executive dashboard use production types and the
 *   default contractor commission.
 */
export { createProductionOrderAction } from "./actions/production";
export { insertProductionOrders } from "./lib/ordersClient";
export { insertProductionMaterials } from "./lib/materialsClient";
export { PRODUCTION_MATERIAL_LIVE_COLUMNS } from "./lib/payloads";
export { DEFAULT_CONTRACTOR_COMMISSION } from "./lib/types";
export type { PurchaseRequest } from "./lib/types";
