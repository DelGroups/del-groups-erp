/**
 * Public API of the inventory module. Other code imports inventory only from here
 * (`@/modules/inventory`), never from its components/, lib/, actions/ or hooks/.
 *
 * The stock engine that sales, purchases, production and products use (src/lib/inventory:
 * stock movements and adjustments, warehouse stock, polywood stock, safety stock; warehouse
 * slips and "send to warehouse") stays in core. This module owns the inventory screens.
 * The stock transfer API route (src/app/api/inventory/transfers) submits transfers here.
 */
export { submitStockTransfer } from "./lib/stockTransferServer";
export type { SubmitStockTransferPayload } from "./lib/stockTransfer";
