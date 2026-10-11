import { defineModule } from "../types";

export default defineModule({
  id: "expenses",
  name: "Expenses",
  version: "1.0.0",
  depends: ["core", "accounting"],
  permissions: ["can_view_expenses", "can_manage_expenses"],
  matrix: [
    { group: "finance", key: "view_expenses", label: "Xərcləri görmək", legacyKey: "can_view_expenses", order: 30 },
    { group: "finance", key: "manage_expenses", label: "Xərcləri idarə etmək", legacyKey: "can_manage_expenses", order: 40 },
    { group: "finance", key: "create_expense", label: "Xərc yaratmaq", legacyKey: "can_manage_expenses", order: 50 },
  ],
  menus: [{ path: "/expenses", label: "nav.items.expenses", icon: "Receipt", section: "finance", order: 30 }],
  routes: [{ prefix: "/expenses", permission: "can_view_expenses" }],
  aiTools: [],
  settings: [],
});
