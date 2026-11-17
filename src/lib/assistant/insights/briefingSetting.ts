/**
 * The daily briefing's on/off switch (AST-7), kept in public.system_settings under one key. Off until an
 * admin turns it on from the home widget. The nightly job reads it first and, when off, does nothing (no
 * rows read, no Claude call, no budget). The GitHub variable ASSISTANT_BRIEFING_ENABLED stays a second,
 * outer gate (whether the job is called at all).
 */

export const BRIEFING_SETTING_KEY = "assistant_briefing";

export interface BriefingSetting {
  enabled: boolean;
  updated_by: string | null;
  updated_at: string | null;
}

export const BRIEFING_OFF: BriefingSetting = { enabled: false, updated_by: null, updated_at: null };

/** Anything but an explicit `enabled: true` is off. */
export function parseBriefingSetting(value: unknown): BriefingSetting {
  if (!value || typeof value !== "object" || Array.isArray(value)) return BRIEFING_OFF;
  const v = value as Record<string, unknown>;
  return {
    enabled: v.enabled === true,
    updated_by: typeof v.updated_by === "string" ? v.updated_by : null,
    updated_at: typeof v.updated_at === "string" ? v.updated_at : null,
  };
}

export function briefingSettingValue(enabled: boolean, userId: string, now: Date = new Date()): BriefingSetting {
  return { enabled, updated_by: userId, updated_at: now.toISOString() };
}

type SettingsDb = { from: (table: string) => unknown };

/** Reads the switch with any client that may read system_settings (an active user, or the server). */
export async function readBriefingSetting(db: SettingsDb): Promise<BriefingSetting> {
  try {
    const q = (db.from("system_settings") as { select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => PromiseLike<{ data: { value?: unknown } | null; error: unknown }> } } })
      .select("value")
      .eq("key", BRIEFING_SETTING_KEY);
    const { data, error } = await q.maybeSingle();
    if (error || !data) return BRIEFING_OFF;
    return parseBriefingSetting(data.value);
  } catch {
    return BRIEFING_OFF;
  }
}
