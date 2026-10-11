"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { requirePermissionAction } from "@/lib/auth/serverActionAuth";
import { catchActionError, type ActionResult } from "@/lib/supabase/actionResult";
import { loadCompanyProfile } from "@/lib/company/loadCompanyProfile";
import { invalidatePublicCompanyInfo } from "@/lib/company/server";
import { COMPANY_PROFILE_TABLE } from "@/lib/company/profile";
import {
  TAX_PAYROLL_CONFIG_KEY,
  parseTaxPayrollConfig,
  vatRateToNumber,
  type TaxPayrollConfig,
} from "@/lib/tax/payrollConfig";

export async function getTaxPayrollConfigAction(): Promise<ActionResult<TaxPayrollConfig>> {
  try {
    await requirePermissionAction("can_manage_settings");
    const admin = createSupabaseAdminClient();
    const [{ data, error }, { profile }] = await Promise.all([
      admin.from("system_settings").select("value").eq("key", TAX_PAYROLL_CONFIG_KEY).maybeSingle(),
      loadCompanyProfile(admin as unknown as SupabaseClient),
    ]);
    if (error) return { success: false, error: error.message };
    const config = parseTaxPayrollConfig(data?.value);
    if (!config.company_voen && profile.voen) {
      config.company_voen = profile.voen.replace(/\D/g, "").slice(0, 10);
    }
    if (!data?.value) {
      const vat = profile.defaultVatRate;
      if (vat >= 17.5) config.default_vat_rate = "18";
      else if (vat <= 0) config.default_vat_rate = "0";
    }
    return { success: true, data: config };
  } catch (err) {
    return catchActionError(err, "Vergi ayarları yüklənmədi");
  }
}

export async function saveTaxPayrollConfigAction(
  input: TaxPayrollConfig
): Promise<ActionResult<TaxPayrollConfig>> {
  try {
    await requirePermissionAction("can_manage_settings");
    const config = parseTaxPayrollConfig(input);
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("system_settings").upsert(
      {
        key: TAX_PAYROLL_CONFIG_KEY,
        value: config,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
    if (error) return { success: false, error: error.message };

    // Keep the company profile's VÖEN and default VAT in step with this page.
    const companyPatch = {
      voen: config.company_voen || "",
      default_vat_rate: vatRateToNumber(config.default_vat_rate),
    };
    const untyped = admin as unknown as SupabaseClient;
    const { source } = await loadCompanyProfile(untyped);
    if (source === "profile") {
      await untyped.from(COMPANY_PROFILE_TABLE).update(companyPatch).eq("id", true);
      invalidatePublicCompanyInfo();
    } else {
      const { data: company } = await admin.from("company_settings").select("id").limit(1).maybeSingle();
      if (company?.id) {
        await admin
          .from("company_settings")
          .update({ voen: config.company_voen || null, vat_rate: companyPatch.default_vat_rate })
          .eq("id", company.id);
      }
    }

    return { success: true, data: config };
  } catch (err) {
    return catchActionError(err, "Vergi ayarları yadda saxlanılmadı");
  }
}
