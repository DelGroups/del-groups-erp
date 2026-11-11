/** Screens of the accounting module, for the thin route files in src/app. */
export { default as CashBankPage } from "./components/CashBankPage";
export { default as PaymentsPage } from "./components/PaymentsPage";
export { default as FinancePage } from "./components/FinancePage";
export { default as OpeningBalancesPage } from "./components/OpeningBalancesPage";
export { default as FinancialReportPage } from "./components/FinancialReportPage";
export { default as GlFinancialReportsPage } from "./components/GlFinancialReportsPage";
export { default as TrialBalancePage } from "./components/TrialBalancePage";
export { default as PartnerReconciliationPage } from "./components/PartnerReconciliationPage";
/** New UI (NEW_UI): accounting screens on the view engine. */
export { FinanceLedgerScreen, CashBankScreen, PaymentsScreen } from "./components/AccountingScreens";
/** PARTNER_LEDGERS (LED-3): the partner statement. */
export { default as PartnerStatementPage } from "./components/partnerStatement/PartnerStatementPage";
/** PARTNER_LEDGERS (LED-3): the partner page's Ledger tab. */
export { default as PartnerStatementPanel } from "./components/partnerStatement/PartnerStatementPanel";
/** UI lab (?frame=statement): the partner statement with sample data. */
export { default as PartnerStatementLab } from "./components/partnerStatement/PartnerStatementLab";
/** PARTNER_LEDGERS (LED-4): debtors, creditors, net and turnover per partner. */
export { default as DebtorCreditorPage } from "./components/debtorReports/DebtorCreditorPage";
/** UI lab (?frame=debtors): the debtor report with sample data. */
export { default as DebtorReportsLab } from "./components/debtorReports/DebtorReportsLab";
