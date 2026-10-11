/**
 * Public API of the commissions module. Other code imports commissions only from
 * here (`@/modules/commissions`), never from its components/ or lib/.
 *
 * The payroll form lists an employee's unpaid commissions. Commissions of a saved sale
 * are recorded through sales' SaleSavedHook (see pages.ts), so sales does not import
 * this module.
 */
export { fetchPendingCommissionsForEmployee } from "./lib/api";
