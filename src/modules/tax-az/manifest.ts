import { defineModule } from "../types";

/** Azerbaijan tax rules: ƏDV, e-qaimə export, payroll tax settings. */
export default defineModule({
  id: "tax-az",
  name: "Azerbaijan tax",
  version: "1.0.0",
  depends: ["core", "accounting"],
  permissions: [],
  matrix: [],
  menus: [{ path: "/settings/tax-payroll", label: "nav.items.taxPayroll", icon: "Scale", section: "settings", order: 90 }],
  routes: [{ prefix: "/settings/tax-payroll", permission: "can_manage_settings" }],
  aiTools: [],
  settings: [{ key: "tax_payroll_config", type: "json" }],
});
