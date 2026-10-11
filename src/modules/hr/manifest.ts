import { defineModule } from "../types";

export default defineModule({
  id: "hr",
  name: "Human resources",
  version: "1.0.0",
  depends: ["core"],
  permissions: ["can_view_hr", "can_manage_hr"],
  matrix: [
    { group: "hr", key: "view", label: "İşçiləri görmək", legacyKey: "can_view_hr", order: 10 },
    { group: "hr", key: "manage", label: "İşçilər və maaş idarəetməsi", legacyKey: "can_manage_hr", order: 20 },
  ],
  menus: [{ path: "/employees", label: "nav.items.employees", icon: "UserCheck", section: "hr", order: 10 }],
  routes: [{ prefix: "/employees", permission: "can_view_hr" }],
  aiTools: [],
  settings: [],
});
