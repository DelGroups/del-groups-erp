/**
 * Server side of the design system: the tenant's brand colour from its company settings
 * (system_settings key "ui_brand", value {"primary": "#hex"}). No row, an unreadable value or
 * any error gives null, and the default brand is used.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { BRAND_SETTING_KEY, parseBrandSetting } from "./brand";

export async function loadBrandColor(client: SupabaseClient): Promise<string | null> {
  try {
    const { data, error } = await client.from("system_settings").select("value").eq("key", BRAND_SETTING_KEY).maybeSingle();
    if (error || !data) return null;
    return parseBrandSetting((data as { value: unknown }).value)?.primary ?? null;
  } catch {
    return null;
  }
}
