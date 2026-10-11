/**
 * Public API of the sales module. Other code imports sales only from here
 * (`@/modules/sales`), never from its components/, lib/, actions/ or hooks/.
 *
 * - Modules that build on sales run work after a sale is saved through SaleSavedHook
 *   (commissions), passed in by the route file.
 * - The e-qaime export (core) reads SaleRecord.
 * - Polywood's mixed-dimensional invoice saves and prints sales.
 */
export { submitSale } from "./lib/submitSale";
export type { SaleSavedHook, SavedSale, SubmitSalePayload } from "./lib/submitSale";
export { fetchSaleById } from "./lib/fetchSales";
export type { SaleRecord } from "./lib/fetchSales";
export { mapSaleToInvoicePrint } from "./lib/mapSaleToInvoicePrint";
export { resolveIssuedByProfileId } from "./lib/invoiceIssuer";
