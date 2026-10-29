/**
 * NEW_HOME (prompt 24b): the widget home page. Server-only switch, off unless the env value is
 * "true"; it only takes effect inside the new shell (NEW_UI). NEW_HOME_AUDIENCE: "admins"
 * (default) shows it to admins only, "all" to everyone; anyone else keeps the app launcher.
 */
export type NewHomeAudience = "admins" | "all";

export function isNewHomeEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return (env.NEW_HOME ?? "").trim().toLowerCase() === "true";
}

export function newHomeAudience(env: Readonly<Record<string, string | undefined>> = process.env): NewHomeAudience {
  return (env.NEW_HOME_AUDIENCE ?? "").trim().toLowerCase() === "all" ? "all" : "admins";
}

/** Does this user get the widget home? */
export function newHomeActive(input: { enabled: boolean; audience: NewHomeAudience; isAdmin: boolean }): boolean {
  return input.enabled && (input.audience === "all" || input.isAdmin);
}
