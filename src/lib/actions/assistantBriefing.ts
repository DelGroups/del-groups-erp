"use server";

import { getServerAuthContext, createSupabaseServerClient } from "@/lib/supabaseServer";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { userHasLegacyPermission } from "@/lib/auth/permissionMatrix";
import { assistantAudience, isAssistantV2On } from "@/lib/assistant/config";
import { BRIEFING_SETTING_KEY, briefingSettingValue, readBriefingSetting } from "@/lib/assistant/insights/briefingSetting";
import { isAdminRole } from "@/types/database.types";

export type BriefingSwitchState = { enabled: boolean; canChange: boolean };
type Result<T> = { success: true; data: T } | { success: false; error: string };

/** Who may see the switch: the assistant is on for them, and they are an admin or may see financial reports. */
async function gate() {
  if (!isAssistantV2On()) return null;
  const { user, profile, isActive } = await getServerAuthContext();
  if (!user || !isActive) return null;
  const isAdmin = isAdminRole(profile?.role);
  if (assistantAudience() === "admins" && !isAdmin) return null;
  if (!isAdmin && !userHasLegacyPermission(profile, "can_view_financial_reports")) return null;
  return { userId: user.id, isAdmin };
}

/** The switch as this user sees it (managers see it, only admins may change it). */
export async function getBriefingSwitchAction(): Promise<Result<BriefingSwitchState>> {
  const g = await gate();
  if (!g) return { success: false, error: "assistant.briefingWidget.notAllowed" };
  const setting = await readBriefingSetting(await createSupabaseServerClient());
  return { success: true, data: { enabled: setting.enabled, canChange: g.isAdmin } };
}

/**
 * Turn the daily briefing on or off (AST-7). Admins only. Saved in system_settings by the server, and every
 * change is written to the audit log (who, when, from and to).
 */
export async function setBriefingEnabledAction(enabled: boolean): Promise<Result<BriefingSwitchState>> {
  if (typeof enabled !== "boolean") return { success: false, error: "assistant.briefingWidget.saveFailed" };
  const g = await gate();
  if (!g || !g.isAdmin) return { success: false, error: "assistant.briefingWidget.notAllowed" };
  const admin = await createSupabaseAdminClient();
  const before = await readBriefingSetting(admin);
  const value = briefingSettingValue(enabled, g.userId);
  const { error } = await admin.from("system_settings").upsert({ key: BRIEFING_SETTING_KEY, value, updated_at: value.updated_at } as never, { onConflict: "key" });
  if (error) return { success: false, error: "assistant.briefingWidget.saveFailed" };
  const audit = await admin.from("audit_logs").insert({
    user_id: g.userId,
    action: "UPDATE",
    module: "SECURITY",
    table_name: "system_settings",
    old_values_json: { key: BRIEFING_SETTING_KEY, enabled: before.enabled },
    new_values_json: { key: BRIEFING_SETTING_KEY, enabled },
  } as never);
  if (audit.error) {
    // Every change must be on the audit log: without the record, put the old value back.
    await admin.from("system_settings").upsert({ key: BRIEFING_SETTING_KEY, value: before, updated_at: new Date().toISOString() } as never, { onConflict: "key" });
    return { success: false, error: "assistant.briefingWidget.saveFailed" };
  }
  return { success: true, data: { enabled, canChange: true } };
}
