import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  BARCODE_LOOKUP_API_CONFIG_KEY,
  parseBarcodeLookupApiConfig,
  type BarcodeLookupApiConfig,
} from "@/lib/barcode/lookupApiConfig";

export async function loadBarcodeLookupApiConfigForServer(): Promise<BarcodeLookupApiConfig> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", BARCODE_LOOKUP_API_CONFIG_KEY)
    .maybeSingle();
  return parseBarcodeLookupApiConfig(data?.value);
}
