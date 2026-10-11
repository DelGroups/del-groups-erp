import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COMPANY_PROFILE_TABLE,
  EMPTY_COMPANY_PROFILE,
  isMissingTableError,
  profileFromLegacy,
  profileFromRow,
  type CompanyProfile,
} from "@/lib/company/profile";

export type CompanyProfileSource = "profile" | "legacy";

/**
 * system_settings key of the CRM settings, where the seal lived before the
 * company profile. Written out here because core must not depend on the CRM
 * module; only this pre-migration fallback reads it.
 */
const LEGACY_CRM_CONFIG_KEY = "crm_config";

/**
 * Reads the company profile with the given client (browser, server or admin;
 * RLS decides what it may see). Falls back to the legacy tables while the
 * company_profile migration has not been applied.
 */
export async function loadCompanyProfile(
  client: SupabaseClient
): Promise<{ profile: CompanyProfile; source: CompanyProfileSource }> {
  const { data, error } = await client.from(COMPANY_PROFILE_TABLE).select("*").limit(1).maybeSingle();
  if (!error) {
    return { profile: data ? profileFromRow(data) : EMPTY_COMPANY_PROFILE, source: "profile" };
  }
  if (!isMissingTableError(error)) throw new Error(error.message);

  const [settings, company, crm] = await Promise.all([
    client.from("settings").select("company_name, voen, phone, address, logo_url").limit(1).maybeSingle(),
    client.from("company_settings").select("*").limit(1).maybeSingle(),
    client.from("system_settings").select("value").eq("key", LEGACY_CRM_CONFIG_KEY).maybeSingle(),
  ]);
  const crmValue = (crm.data?.value ?? {}) as Record<string, unknown>;
  return {
    profile: profileFromLegacy(settings.data, company.data, crmValue.company_seal_signature_url),
    source: "legacy",
  };
}
