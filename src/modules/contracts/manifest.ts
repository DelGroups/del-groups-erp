import { defineModule } from "../types";

/**
 * Sales and purchase contracts. Always on together with sales and purchases:
 * official invoices must name a contract, so both depend on this module (and
 * enabling either keeps contracts enabled).
 */
export default defineModule({
  id: "contracts",
  name: "Contracts",
  version: "1.0.0",
  depends: ["core"],
  // The contracts page is open to whoever can view sales (sales depends on this module).
  borrowsPermissionsFrom: ["sales"],
  permissions: [],
  matrix: [],
  menus: [{ path: "/contracts", label: "nav.items.contracts", icon: "FileText", section: "trade", order: 30 }],
  routes: [{ prefix: "/contracts", permission: "can_view_sales" }],
  aiTools: [],
  settings: [],
});
