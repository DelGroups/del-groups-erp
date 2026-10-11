import { defineModule } from "../types";

/** Studio: custom fields on records. */
export default defineModule({
  id: "studio",
  name: "Studio",
  version: "1.0.0",
  depends: ["core"],
  permissions: [],
  matrix: [],
  menus: [{ path: "/settings/studio", label: "nav.items.studio", icon: "Blocks", section: "settings", order: 120 }],
  routes: [{ prefix: "/settings/studio", permission: "can_manage_settings" }],
  aiTools: [],
  settings: [],
});
