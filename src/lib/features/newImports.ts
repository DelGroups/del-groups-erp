/**
 * NEW_IMPORTS (IMP-1): the Imports module ("İdxal"): import shipments, CBAR exchange rates and
 * landed cost. Server-only switch, off unless the env value is "true". It only takes effect for
 * users of the new shell (NEW_UI); while off, /imports and /settings/imports are a 404, the
 * launcher has no tile and the server actions refuse.
 */
export function isNewImportsEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return (env.NEW_IMPORTS ?? "").trim().toLowerCase() === "true";
}
