"use server";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { requirePermissionAction } from "@/lib/auth/serverActionAuth";
import { catchActionError, type ActionResult } from "@/lib/supabase/actionResult";
import {
  BARCODE_LOOKUP_API_CONFIG_KEY,
  parseBarcodeLookupApiConfig,
  validateBarcodeLookupApiConfig,
  type BarcodeLookupApiConfig,
} from "@/lib/barcode/lookupApiConfig";

export async function getBarcodeLookupApiConfigAction(): Promise<
  ActionResult<BarcodeLookupApiConfig>
> {
  try {
    await requirePermissionAction("can_view_settings");
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("system_settings")
      .select("value")
      .eq("key", BARCODE_LOOKUP_API_CONFIG_KEY)
      .maybeSingle();

    if (error) return { success: false, error: error.message };
    return { success: true, data: parseBarcodeLookupApiConfig(data?.value) };
  } catch (err) {
    return catchActionError(err, "Barkod API ayarları yüklənmədi");
  }
}

export async function saveBarcodeLookupApiConfigAction(
  input: BarcodeLookupApiConfig
): Promise<ActionResult<BarcodeLookupApiConfig>> {
  try {
    await requirePermissionAction("can_manage_settings");
    const config = parseBarcodeLookupApiConfig(input);
    const checked = validateBarcodeLookupApiConfig(config);
    if (!checked.ok) return { success: false, error: checked.error };

    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("system_settings").upsert(
      {
        key: BARCODE_LOOKUP_API_CONFIG_KEY,
        value: config,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
    if (error) return { success: false, error: error.message };
    return { success: true, data: config };
  } catch (err) {
    return catchActionError(err, "Barkod API ayarları yadda saxlanılmadı");
  }
}

