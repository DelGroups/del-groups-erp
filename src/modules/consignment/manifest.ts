import { defineModule } from "../types";

export default defineModule({
  id: "consignment",
  name: "Consignment",
  version: "1.0.0",
  depends: ["core", "inventory", "sales"],
  permissions: ["can_view_consignments", "can_manage_consignments"],
  matrix: [
    { group: "consignments", key: "view", label: "Əmanət sənədlərini görmək", legacyKey: "can_view_consignments", order: 10 },
    { group: "consignments", key: "manage", label: "Əmanət sənədlərini idarə etmək", legacyKey: "can_manage_consignments", order: 20 },
  ],
  menus: [{ path: "/consignments", label: "nav.items.consignments", icon: "FileSpreadsheet", section: "trade", order: 40 }],
  routes: [{ prefix: "/consignments", permission: "can_view_consignments" }],
  aiTools: [],
  settings: [],
});
