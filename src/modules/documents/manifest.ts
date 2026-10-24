import { defineModule } from "../types";

/**
 * Documents (phase 23): folders with access rules, files with tags and record links, file
 * requests, and system folders that show existing attachments where they are. New UI only: no
 * classic menu item, the page is reached from the new shell (SHELL_EXTRA_ITEMS). Everyone who can
 * open the dashboard may open it; folder rules (row level security) decide what each user sees.
 */
export default defineModule({
  id: "documents",
  name: "Documents",
  version: "1.0.0",
  depends: ["core"],
  permissions: [],
  matrix: [],
  menus: [],
  routes: [{ prefix: "/documents", permission: "can_view_dashboard" }],
  links: ["/documents"],
  aiTools: [],
  settings: [],
});
