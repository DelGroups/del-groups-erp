import { defineModule } from "../types";

/** Deals pipeline and quotations. Customers and suppliers belong to core. */
export default defineModule({
  id: "crm",
  name: "CRM",
  version: "1.0.0",
  depends: ["core", "sales"],
  permissions: ["can_view_crm", "can_manage_crm"],
  matrix: [
    { group: "crm", key: "view_pipeline", label: "CRM boru xəttini görmək", legacyKey: "can_view_crm", order: 30 },
    { group: "crm", key: "manage_pipeline", label: "CRM boru xəttini idarə etmək", legacyKey: "can_manage_crm", order: 40 },
  ],
  menus: [
    { path: "/crm", label: "nav.items.pipeline", icon: "KanbanSquare", section: "crm", order: 10 },
    { path: "/settings/crm", label: "nav.items.crmSettings", icon: "KanbanSquare", section: "settings", order: 80 },
  ],
  routes: [
    { prefix: "/crm", permission: "can_view_crm" },
    { prefix: "/settings/crm", permission: "can_manage_settings" },
  ],
  aiTools: [],
  settings: [{ key: "crm_config", type: "json" }],
});
