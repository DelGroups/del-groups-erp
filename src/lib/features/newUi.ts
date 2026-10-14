/**
 * NEW_UI (prompt 15 and later): the new shell and design system. Server-only switch, off unless
 * the env value is "true"; while off, /dev/design answers 404 and nothing of the new UI shows.
 */
export function isNewUiEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return (env.NEW_UI ?? "").trim().toLowerCase() === "true";
}
