import { defineModule } from "../types";

/** Sheet cutting (Polywood): mixed-dimension sales and stock import. */
export default defineModule({
  id: "polywood",
  name: "Polywood",
  version: "1.0.0",
  depends: ["core", "inventory", "sales"],
  permissions: [],
  matrix: [],
  menus: [],
  routes: [
    { prefix: "/sales/polywood/new", permission: "can_create_invoice" },
    { prefix: "/polywood", permission: "can_view_products" },
    { prefix: "/dashboard/inventory/polywood/import", permission: "can_manage_products" },
  ],
  links: ["/sales/polywood/new", "/polywood", "/dashboard/inventory/polywood/import"],
  aiTools: [],
  settings: [],
});
