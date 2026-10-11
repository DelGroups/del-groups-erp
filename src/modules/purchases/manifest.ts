import { defineModule } from "../types";

export default defineModule({
  id: "purchases",
  name: "Purchases",
  version: "1.0.0",
  depends: ["core", "inventory", "accounting", "contracts"],
  permissions: ["can_view_purchases", "can_create_purchase", "can_edit_purchases", "can_delete_purchases"],
  matrix: [
    { group: "purchases", key: "view", label: "Alışları görmək", legacyKey: "can_view_purchases", order: 10 },
    { group: "purchases", key: "create", label: "Alış fakturası yaratmaq", legacyKey: "can_create_purchase", order: 20 },
    { group: "purchases", key: "edit", label: "Alışları redaktə etmək", legacyKey: "can_edit_purchases", order: 30 },
    { group: "purchases", key: "delete", label: "Alışları silmək", legacyKey: "can_delete_purchases", order: 40 },
  ],
  menus: [
    { path: "/purchases", label: "nav.items.purchases", icon: "ShoppingBag", section: "trade", order: 20 },
    { path: "/settings/procurement", label: "nav.items.procurement", icon: "ShoppingBag", section: "settings", order: 100 },
  ],
  routes: [
    { prefix: "/purchases", permission: "can_view_purchases" },
    { prefix: "/settings/procurement", permission: "can_manage_settings" },
  ],
  aiTools: [],
  settings: [{ key: "procurement_config", type: "json" }],
});
