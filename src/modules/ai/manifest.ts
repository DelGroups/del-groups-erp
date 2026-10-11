import { defineModule } from "../types";

/** AI assistant (native Claude agent and the n8n bridge). Its tools are listed by the modules whose data they read. */
export default defineModule({
  id: "ai",
  name: "AI assistant",
  version: "1.0.0",
  depends: ["core"],
  permissions: [],
  matrix: [],
  menus: [{ path: "/settings/ai", label: "nav.items.aiIntegration", icon: "Sparkles", section: "settings", order: 110 }],
  routes: [{ prefix: "/settings/ai", permission: "can_manage_settings" }],
  aiTools: [],
  settings: [{ key: "n8n_ai_config", type: "json" }],
});
