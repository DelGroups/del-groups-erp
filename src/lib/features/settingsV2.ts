/**
 * SETTINGS_V2 (SET-1): the new Settings layout: a hub at /settings with grouped cards and search,
 * a side menu inside every settings page instead of the shell's app tab bar, the standard page
 * header, and one sticky save bar. Server-only switch, off unless the env value is "true". It only
 * takes effect for users of the new shell (NEW_UI); with it off Settings looks as before.
 */
export function isSettingsV2Enabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return (env.SETTINGS_V2 ?? "").trim().toLowerCase() === "true";
}
