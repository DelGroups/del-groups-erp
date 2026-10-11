import { defineModule } from "../types";

export default defineModule({
  id: "production",
  name: "Production",
  version: "1.0.0",
  depends: ["core", "inventory"],
  permissions: [
    "can_view_production",
    "can_manage_production",
    "can_view_production_financials",
    "can_approve_purchase_requests",
  ],
  matrix: [
    { group: "production", key: "view", label: "İstehsalatı görmək", legacyKey: "can_view_production", order: 10 },
    { group: "production", key: "manage", label: "İstehsalatın idarə edilməsi (CRUD)", legacyKey: "can_manage_production", order: 20 },
    {
      group: "production",
      key: "view_financials",
      label: "Maliyyə məlumatlarını görmək (büdcə, mənfəət)",
      legacyKey: "can_view_production_financials",
      order: 30,
    },
    {
      group: "production",
      key: "approve_purchase",
      label: "Satın alma tələbi təsdiqləmək",
      legacyKey: "can_approve_purchase_requests",
      order: 40,
    },
  ],
  menus: [
    { path: "/production", label: "nav.items.production", icon: "Factory", section: "production", order: 10 },
    { path: "/production/bom", label: "nav.items.productionBom", icon: "Layers", section: "production", order: 20 },
  ],
  routes: [{ prefix: "/production", permission: "can_view_production" }],
  aiTools: ["production_orders"],
  settings: [],
});
