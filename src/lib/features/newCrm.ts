/**
 * NEW_CRM (prompt 21): the new CRM pipeline (teams, stages, leads, won/lost, reports, targets).
 * Server-only switch, off unless the env value is "true". It only takes effect for users of the
 * new shell (NEW_UI); while off, /crm shows the screens it showed before.
 */
export function isNewCrmEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return (env.NEW_CRM ?? "").trim().toLowerCase() === "true";
}
