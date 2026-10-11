import { defineModule } from "../types";

export default defineModule({
  id: "sales",
  name: "Sales",
  version: "1.0.0",
  depends: ["core", "inventory", "accounting", "contracts"],
  permissions: ["can_view_sales", "can_create_invoice", "can_edit_sales", "can_delete_sales"],
  matrix: [
    { group: "sales", key: "view", label: "Satışları görmək", legacyKey: "can_view_sales", order: 10 },
    { group: "sales", key: "create", label: "Satış fakturası yaratmaq", legacyKey: "can_create_invoice", order: 20 },
    { group: "sales", key: "edit", label: "Satışları redaktə etmək", legacyKey: "can_edit_sales", order: 30 },
    { group: "sales", key: "delete", label: "Satışları silmək", legacyKey: "can_delete_sales", order: 40 },
  ],
  menus: [
    { path: "/sales", label: "nav.items.sales", icon: "ShoppingCart", section: "trade", order: 10, keywords: ["invoice", "faktura"] },
  ],
  routes: [
    { prefix: "/sales/new", permission: "can_create_invoice" },
    { prefix: "/sales", permission: "can_view_sales" },
    { prefix: "/reports/sales", permission: "can_view_reports" },
  ],
  aiTools: ["list_sales", "get_sale"],
  settings: [],
});
