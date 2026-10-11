/**
 * Public API of the commissions module. Other code imports commissions only from
 * here (`@/modules/commissions`), never from its components/ or lib/.
 *
 * Saving a sale records its commissions, and the payroll form lists an
 * employee's unpaid commissions.
 */
export { recordSaleCommissions } from "./lib/recordSaleCommissions";
export { fetchPendingCommissionsForEmployee } from "./lib/api";
