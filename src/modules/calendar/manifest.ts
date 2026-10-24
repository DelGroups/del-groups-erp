import { defineModule } from "../types";

/**
 * Calendar (phase 20): team and personal events, attendees, reminders, ICS export; meeting
 * activities of the chatter become events. New UI only: no classic menu item, the page is
 * reached from the new shell (src/lib/shell/shell.ts SHELL_EXTRA_ITEMS). Everyone who can open
 * the dashboard may open it; row level security decides which events each user sees.
 */
export default defineModule({
  id: "calendar",
  name: "Calendar",
  version: "1.0.0",
  depends: ["core"],
  permissions: [],
  matrix: [],
  menus: [],
  routes: [{ prefix: "/calendar", permission: "can_view_dashboard" }],
  links: ["/calendar"],
  aiTools: [],
  settings: [],
});
