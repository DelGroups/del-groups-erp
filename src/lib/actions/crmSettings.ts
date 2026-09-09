"use server";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { requirePermissionAction } from "@/lib/auth/serverActionAuth";
import { catchActionError, type ActionResult } from "@/lib/supabase/actionResult";
import { clampString } from "@/lib/auth/validate";
import {
  CRM_CONFIG_KEY,
  DEFAULT_CRM_CONFIG,
  parseCrmConfig,
  type CrmConfig,
} from "@/lib/crm/config";

const SEAL_BUCKET = "crm-assets";
const MAX_SEAL_BYTES = 5 * 1024 * 1024;
const ALLOWED_SEAL_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

export async function getCrmConfigAction(): Promise<ActionResult<CrmConfig>> {
  try {
    await requirePermissionAction("can_manage_settings");
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("system_settings")
      .select("value")
      .eq("key", CRM_CONFIG_KEY)
      .maybeSingle();
    if (error) return { success: false, error: error.message };
    return { success: true, data: parseCrmConfig(data?.value) };
  } catch (err) {
    return catchActionError(err, "CRM ayarları yüklənmədi");
  }
}

export async function saveCrmConfigAction(input: CrmConfig): Promise<ActionResult<CrmConfig>> {
  try {
    await requirePermissionAction("can_manage_settings");
    const config = parseCrmConfig({
      ...input,
      quote_prefix: clampString(input.quote_prefix || DEFAULT_CRM_CONFIG.quote_prefix, 24),
      terms_and_conditions: clampString(input.terms_and_conditions || "", 8000),
    });
    if (config.stages.length < 2) {
      return { success: false, error: "Ən azı iki pipeline mərhələsi lazımdır" };
    }
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("system_settings").upsert(
      {
        key: CRM_CONFIG_KEY,
        value: config,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
    if (error) return { success: false, error: error.message };
    return { success: true, data: config };
  } catch (err) {
    return catchActionError(err, "CRM ayarları yadda saxlanılmadı");
  }
}

export async function uploadCrmSealAction(formData: FormData): Promise<ActionResult<{ url: string }>> {
  try {
    await requirePermissionAction("can_manage_settings");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size <= 0) {
      return { success: false, error: "Şəkil seçin" };
    }
    if (file.size > MAX_SEAL_BYTES) {
      return { success: false, error: "Şəkil 5 MB-dan kiçik olmalıdır" };
    }
    const mime = (file.type || "").toLowerCase();
    if (!ALLOWED_SEAL_TYPES.has(mime)) {
      return { success: false, error: "Yalnız PNG, JPG və ya WEBP qəbul olunur" };
    }
    const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
    const path = `seals/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const admin = createSupabaseAdminClient();
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error } = await admin.storage.from(SEAL_BUCKET).upload(path, buffer, {
      contentType: mime,
      upsert: true,
    });
    if (error) return { success: false, error: error.message };
    const { data } = admin.storage.from(SEAL_BUCKET).getPublicUrl(path);
    return { success: true, data: { url: data.publicUrl } };
  } catch (err) {
    return catchActionError(err, "Möhür yüklənmədi");
  }
}
