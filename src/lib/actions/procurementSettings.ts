"use server";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { requirePermissionAction } from "@/lib/auth/serverActionAuth";
import { catchActionError, type ActionResult } from "@/lib/supabase/actionResult";
import {
  PROCUREMENT_CONFIG_KEY,
  parseProcurementConfig,
  type ProcurementConfig,
} from "@/lib/procurement/config";

export async function getProcurementConfigAction(): Promise<ActionResult<ProcurementConfig>> {
  try {
    await requirePermissionAction("can_manage_settings");
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("system_settings")
      .select("value")
      .eq("key", PROCUREMENT_CONFIG_KEY)
      .maybeSingle();
    if (error) return { success: false, error: error.message };
    return { success: true, data: parseProcurementConfig(data?.value) };
  } catch (err) {
    return catchActionError(err, "Satınalma ayarları yüklənmədi");
  }
}

export async function saveProcurementConfigAction(
  input: ProcurementConfig
): Promise<ActionResult<ProcurementConfig>> {
  try {
    await requirePermissionAction("can_manage_settings");
    const config = parseProcurementConfig(input);
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("system_settings").upsert(
      {
        key: PROCUREMENT_CONFIG_KEY,
        value: config,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
    if (error) return { success: false, error: error.message };
    return { success: true, data: config };
  } catch (err) {
    return catchActionError(err, "Satınalma ayarları yadda saxlanılmadı");
  }
}
