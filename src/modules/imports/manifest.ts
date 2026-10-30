import { defineModule } from "../types";

/**
 * Imports ("İdxal", IMP-1): import shipments in a foreign currency, CBAR exchange rates and the
 * landed cost of every product line. New UI only and behind NEW_IMPORTS: no classic menu item,
 * the new shell's launcher lists it (SHELL_EXTRA_ITEMS) while the flag is on. The normal purchase
 * flow is not touched; stock and ledger posting come in IMP-2.
 */
export default defineModule({
  id: "imports",
  name: "Imports",
  version: "1.0.0",
  depends: ["core", "purchases"],
  permissions: ["can_view_imports", "can_manage_imports", "can_approve_imports"],
  matrix: [
    { group: "imports", key: "view", label: "İdxal sənədlərini görmək", labelKey: "imports.permissions.view", legacyKey: "can_view_imports", order: 10 },
    { group: "imports", key: "manage", label: "İdxal sənədlərini idarə etmək", labelKey: "imports.permissions.manage", legacyKey: "can_manage_imports", order: 20 },
    { group: "imports", key: "approve", label: "İdxal sənədlərini təsdiqləmək", labelKey: "imports.permissions.approve", legacyKey: "can_approve_imports", order: 30 },
  ],
  menus: [],
  routes: [
    { prefix: "/imports", permission: "can_view_imports" },
    { prefix: "/settings/imports", permission: "can_manage_settings" },
  ],
  links: ["/imports", "/settings/imports"],
  aiTools: [],
  settings: [{ key: "imports_config", type: "json" }],
});
