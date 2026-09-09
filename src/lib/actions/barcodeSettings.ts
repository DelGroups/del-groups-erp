"use server";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { requirePermissionAction } from "@/lib/auth/serverActionAuth";
import { catchActionError, type ActionResult } from "@/lib/supabase/actionResult";
import { clampString } from "@/lib/auth/validate";
import {
  BARCODE_LABEL_CONFIG_KEY,
  DEFAULT_BARCODE_LABEL_CONFIG,
  parseBarcodeLabelConfig,
  type BarcodeLabelConfig,
} from "@/lib/barcode/labelConfig";

export async function getBarcodeLabelConfigAction(): Promise<ActionResult<BarcodeLabelConfig>> {
  try {
    await requirePermissionAction("can_view_settings");
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("system_settings")
      .select("value")
      .eq("key", BARCODE_LABEL_CONFIG_KEY)
      .maybeSingle();

    if (error) return { success: false, error: error.message };
    return { success: true, data: parseBarcodeLabelConfig(data?.value) };
  } catch (err) {
    return catchActionError(err, "Etiket ayarları yüklənmədi");
  }
}

export async function saveBarcodeLabelConfigAction(
  input: BarcodeLabelConfig
): Promise<ActionResult<BarcodeLabelConfig>> {
  try {
    await requirePermissionAction("can_manage_settings");
    const config: BarcodeLabelConfig = {
      ...parseBarcodeLabelConfig(input),
      header_title: clampString(input.header_title || DEFAULT_BARCODE_LABEL_CONFIG.header_title, 80),
    };
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("system_settings").upsert(
      {
        key: BARCODE_LABEL_CONFIG_KEY,
        value: config,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
    if (error) return { success: false, error: error.message };
    return { success: true, data: config };
  } catch (err) {
    return catchActionError(err, "Etiket ayarları yadda saxlanılmadı");
  }
}
