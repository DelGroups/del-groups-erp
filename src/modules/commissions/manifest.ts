import { defineModule } from "../types";

export default defineModule({
  id: "commissions",
  name: "Commissions",
  version: "1.0.0",
  depends: ["core", "hr", "sales"],
  permissions: ["can_view_commissions", "can_manage_commissions"],
  matrix: [
    { group: "hr", key: "view_commissions", label: "Komissiyaları görmək", legacyKey: "can_view_commissions", order: 30 },
    { group: "hr", key: "manage_commissions", label: "Komissiyaları idarə etmək", legacyKey: "can_manage_commissions", order: 40 },
  ],
  menus: [
    { path: "/commissions", label: "nav.items.commissions", icon: "Percent", section: "hr", order: 20 },
    { path: "/settings/commissions", label: "nav.items.commissionRules", icon: "Percent", section: "settings", order: 40 },
  ],
  routes: [
    { prefix: "/commissions", permission: "can_view_commissions" },
    // Older spelling of the commissions pages, still linked from reports.
    { prefix: "/comissions/report", permission: "can_view_commissions" },
    { prefix: "/comissions", permission: "can_view_commissions" },
    { prefix: "/settings/commissions", permission: "can_manage_commissions" },
  ],
  links: ["/comissions"],
  aiTools: [],
  settings: [],
});
