import { defineModule } from "../types";

/** Double-entry accounting: cash & bank, payments, journal, opening balances, financial reports. */
export default defineModule({
  id: "accounting",
  name: "Accounting",
  version: "1.0.0",
  depends: ["core"],
  permissions: ["can_view_finance", "can_manage_finance", "can_view_financial_reports"],
  matrix: [
    { group: "finance", key: "view", label: "Kassa və tranzaksiyaları görmək", legacyKey: "can_view_finance", order: 10 },
    { group: "finance", key: "manage", label: "Kassa və tranzaksiyaları idarə etmək", legacyKey: "can_manage_finance", order: 20 },
    { group: "finance", key: "create_income", label: "Mədaxil yaratmaq", legacyKey: "can_manage_finance", order: 60 },
    { group: "finance", key: "view_reports", label: "Maliyyə hesabatlarını görmək", legacyKey: "can_view_financial_reports", order: 70 },
    { group: "reports", key: "view_financial", label: "Maliyyə hesabatlarını görmək", legacyKey: "can_view_financial_reports", order: 20 },
  ],
  menus: [
    { path: "/cash-bank", label: "nav.items.cashBank", icon: "Wallet", section: "finance", order: 10 },
    { path: "/dashboard/payments", label: "nav.items.payments", icon: "Wallet", section: "finance", order: 20 },
    { path: "/finance", label: "nav.items.finance", icon: "CircleDollarSign", section: "finance", order: 40 },
    { path: "/finance/opening-balances", label: "nav.items.financialOpeningBalances", icon: "Landmark", section: "finance", order: 50 },
    { path: "/dashboard/reports/financial", label: "nav.items.glFinancialReports", icon: "BarChart3", section: "reports", order: 20 },
    { path: "/dashboard/reports/osv", label: "nav.items.trialBalance", icon: "Table2", section: "reports", order: 30 },
    { path: "/dashboard/reports/reconciliation", label: "nav.items.reconciliationAct", icon: "FileCheck2", section: "reports", order: 40 },
  ],
  routes: [
    { prefix: "/cash-bank", permission: "can_view_finance" },
    { prefix: "/dashboard/payments", permission: "can_view_finance" },
    { prefix: "/finance/opening-balances", permission: "can_manage_settings" },
    { prefix: "/finance", permission: "can_view_finance" },
    { prefix: "/reports/financial", permission: "can_view_financial_reports" },
    { prefix: "/dashboard/reports/financial", permission: "can_view_financial_reports" },
    { prefix: "/dashboard/reports/osv", permission: "can_view_financial_reports" },
    { prefix: "/dashboard/reports/reconciliation", permission: "can_view_financial_reports" },
  ],
  aiTools: ["finance_summary", "top_debtors"],
  settings: [],
});
