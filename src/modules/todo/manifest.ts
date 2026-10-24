import { defineModule } from "../types";

/**
 * To-do (phase 22): personal tasks with personal stages, checklist, assignees and chatter. New UI
 * only: no classic menu item, the page is reached from the new shell (SHELL_EXTRA_ITEMS) and the
 * command palette ("New to-do"). Everyone who can open the dashboard may open it; row level
 * security limits each user to the tasks they work on.
 */
export default defineModule({
  id: "todo",
  name: "To-do",
  version: "1.0.0",
  depends: ["core"],
  permissions: [],
  matrix: [],
  menus: [],
  routes: [{ prefix: "/todo", permission: "can_view_dashboard" }],
  links: ["/todo"],
  aiTools: [],
  settings: [],
});
