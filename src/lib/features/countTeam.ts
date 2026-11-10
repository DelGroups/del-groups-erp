/**
 * COUNT_TEAM (INV-4): the inventory count's "Responsible" becomes a list of employees (several
 * people) instead of free text. Server-only switch, off unless the env value is "true". The root
 * layout passes it to client screens through CountTeamProvider; while off the free-text field
 * works exactly as before.
 */
export function isCountTeamEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return (env.COUNT_TEAM ?? "").trim().toLowerCase() === "true";
}
