"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { requirePermissionAction } from "@/lib/auth/serverActionAuth";
import { catchActionError, type ActionResult } from "@/lib/supabase/actionResult";
import { isAdminRole } from "@/types/database.types";
import { loadCompanyProfile } from "@/lib/company/loadCompanyProfile";
import { invalidatePublicCompanyInfo } from "@/lib/company/server";
import {
  COMPANY_ASSET_BUCKET,
  COMPANY_PROFILE_TABLE,
  mergeProfileEdit,
  profileToRow,
  type CompanyProfile,
} from "@/lib/company/profile";

import { storageFullError } from "@/lib/limits/messages";
const MAX_ASSET_BYTES = 5 * 1024 * 1024;
const ALLOWED_ASSET_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

export async function saveCompanyProfileAction(
  input: Partial<CompanyProfile>
): Promise<ActionResult<CompanyProfile>> {
  try {
    const { profile: me } = await requirePermissionAction("can_manage_settings");
    const client = (await createSupabaseServerClient()) as unknown as SupabaseClient;
    const { profile: current, source } = await loadCompanyProfile(client);
    const { profile, refused } = mergeProfileEdit(current, input, { isAdmin: isAdminRole(me?.role) });
    if (refused.length) {
      return { success: false, error: "settings.companyErrors.adminOnly" };
    }

    if (source === "legacy") {
      // The company_profile migration has not run yet: keep saving where the
      // old form saved, so this page works exactly as before.
      const legacy = {
        company_name: profile.legalName,
        voen: profile.voen,
        address: profile.address,
        phone: profile.phone,
        email: profile.email,
        bank_name: profile.bankName,
        iban: profile.iban,
        vat_rate: profile.defaultVatRate,
        currency: profile.defaultCurrency,
      };
      const { data: row } = await client.from("company_settings").select("id").limit(1).maybeSingle();
      const { error } = row?.id
        ? await client.from("company_settings").update(legacy).eq("id", row.id)
        : await client.from("company_settings").insert([legacy]);
      if (error) return { success: false, error: error.message };
    } else {
      const { error } = await client
        .from(COMPANY_PROFILE_TABLE)
        .upsert({ id: true, ...profileToRow(profile) }, { onConflict: "id" });
      if (error) return { success: false, error: error.message };
    }

    invalidatePublicCompanyInfo();
    return { success: true, data: profile };
  } catch (err) {
    return catchActionError(err, "settings.companyErrors.saveFailed");
  }
}

/** Uploads a logo or seal image and returns its public URL; saving it is a separate step. */
export async function uploadCompanyAssetAction(
  formData: FormData
): Promise<ActionResult<{ url: string }>> {
  try {
    const { profile: me } = await requirePermissionAction("can_manage_settings");
    if (!isAdminRole(me?.role)) {
      return { success: false, error: "settings.companyErrors.adminOnly" };
    }
    const kind = formData.get("kind") === "seal" ? "seal" : "logo";
    const file = formData.get("file");
    if (!(file instanceof File) || file.size <= 0) {
      return { success: false, error: "settings.companyErrors.chooseImage" };
    }
    if (file.size > MAX_ASSET_BYTES) {
      return { success: false, error: "settings.companyErrors.imageTooLarge" };
    }
    const mime = (file.type || "").toLowerCase();
    if (!ALLOWED_ASSET_TYPES.has(mime)) {
      return { success: false, error: "settings.companyErrors.imageType" };
    }
    const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
    const folder = kind === "seal" ? "seals" : "company";
    const path = `${folder}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    if (await storageFullError()) return { success: false, error: "limits.storageFull" };
    const admin = await createSupabaseAdminClient();
    const { error } = await admin.storage.from(COMPANY_ASSET_BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), {
      contentType: mime,
      upsert: false,
    });
    if (error) return { success: false, error: error.message };
    const { data } = admin.storage.from(COMPANY_ASSET_BUCKET).getPublicUrl(path);
    return { success: true, data: { url: data.publicUrl } };
  } catch (err) {
    return catchActionError(err, "settings.companyErrors.uploadFailed");
  }
}
