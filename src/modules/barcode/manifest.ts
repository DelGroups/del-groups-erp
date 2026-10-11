import { defineModule } from "../types";

/** Barcode generation, label printing and barcode lookup. */
export default defineModule({
  id: "barcode",
  name: "Barcode",
  version: "1.0.0",
  depends: ["core", "inventory"],
  permissions: [],
  matrix: [],
  menus: [
    {
      path: "/settings/barcode",
      label: "nav.items.barcode",
      icon: "Barcode",
      section: "settings",
      order: 70,
      flag: "barcodeModule",
    },
  ],
  routes: [{ prefix: "/settings/barcode", permission: "can_manage_settings" }],
  aiTools: [],
  settings: [
    { key: "barcode_label_config", type: "json" },
    { key: "barcode_lookup_api_config", type: "json" },
  ],
});
