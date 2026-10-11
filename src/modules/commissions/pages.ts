/** Screens of the commissions module, for the thin route files in src/app. */
export { default as CommissionsPage } from "./components/CommissionsPage";
export { default as CommissionRulesPage } from "./components/CommissionRulesPage";
export { default as LegacyCommissionRulesPage } from "./components/LegacyCommissionRulesPage";
export { default as MonthlyCommissionReportPage } from "./components/MonthlyCommissionReportPage";
/** For the sales route: run after a sale is saved, when commissions is enabled. */
export { recordCommissionsAfterSale } from "./lib/saleSavedHook";
