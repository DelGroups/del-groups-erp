import { defineModule } from "../types";

export default defineModule({
  id: "contracts",
  name: "Contracts",
  version: "1.0.0",
  depends: ["core", "sales"],
  permissions: [],
  matrix: [],
  menus: [{ path: "/contracts", label: "nav.items.contracts", icon: "FileText", section: "trade", order: 30 }],
  routes: [{ prefix: "/contracts", permission: "can_view_sales" }],
  aiTools: [],
  settings: [],
});
