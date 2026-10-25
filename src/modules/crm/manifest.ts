import { defineModule } from "../types";

/**
 * Deals pipeline and quotations. Customers and suppliers belong to core. With NEW_CRM on, the new
 * shell shows the new pipeline (teams, stages, leads, won/lost, reports, targets, prompt 21);
 * its pages are reached from the new shell only (SHELL_EXTRA_ITEMS), so the classic menu is unchanged.
 */
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
    // New CRM (prompt 21, NEW_CRM): teams, stages, lost reasons and targets.
    { prefix: "/crm/config", permission: "can_manage_settings" },
    { prefix: "/settings/crm", permission: "can_manage_settings" },
  ],
  aiTools: [],
  settings: [{ key: "crm_config", type: "json" }],
});
