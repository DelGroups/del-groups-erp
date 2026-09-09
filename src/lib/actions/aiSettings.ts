"use server";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { requirePermissionAction } from "@/lib/auth/serverActionAuth";
import { catchActionError, type ActionResult } from "@/lib/supabase/actionResult";
import {
  N8N_AI_CONFIG_KEY,
  parseN8nAiConfig,
  toPublicN8nConfig,
  validateN8nWebhookUrl,
  type N8nAiPublicConfig,
} from "@/lib/ai/n8nConfig";

export async function getN8nAiConfigAction(): Promise<ActionResult<N8nAiPublicConfig>> {
  try {
    await requirePermissionAction("can_manage_settings");
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("system_settings")
      .select("value")
      .eq("key", N8N_AI_CONFIG_KEY)
      .maybeSingle();
    if (error) return { success: false, error: error.message };
    return { success: true, data: toPublicN8nConfig(parseN8nAiConfig(data?.value)) };
  } catch (err) {
    return catchActionError(err, "AI inteqrasiya ayarları yüklənmədi");
  }
}

export async function saveN8nAiConfigAction(input: {
  webhook_url?: string;
  secret_token?: string;
}): Promise<ActionResult<N8nAiPublicConfig>> {
  try {
    await requirePermissionAction("can_manage_settings");
    const checked = validateN8nWebhookUrl(input.webhook_url || "");
    if (!checked.ok) return { success: false, error: checked.error };

    const admin = createSupabaseAdminClient();
    const existing = await admin
      .from("system_settings")
      .select("value")
      .eq("key", N8N_AI_CONFIG_KEY)
      .maybeSingle();
    if (existing.error) return { success: false, error: existing.error.message };

    const previous = parseN8nAiConfig(existing.data?.value);
    const nextSecret = (input.secret_token || "").trim();
    const config = parseN8nAiConfig({
      webhook_url: checked.url,
      secret_token: nextSecret || previous.secret_token,
    });

    const { error } = await admin.from("system_settings").upsert(
      {
        key: N8N_AI_CONFIG_KEY,
        value: config,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
    if (error) return { success: false, error: error.message };
    return { success: true, data: toPublicN8nConfig(config) };
  } catch (err) {
    return catchActionError(err, "AI inteqrasiya ayarları yadda saxlanılmadı");
  }
}
