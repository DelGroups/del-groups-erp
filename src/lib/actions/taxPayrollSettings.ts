"use server";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { requirePermissionAction } from "@/lib/auth/serverActionAuth";
import { catchActionError, type ActionResult } from "@/lib/supabase/actionResult";
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
    const [{ data, error }, { data: company }] = await Promise.all([
      admin.from("system_settings").select("value").eq("key", TAX_PAYROLL_CONFIG_KEY).maybeSingle(),
      admin.from("company_settings").select("voen, vat_rate").limit(1).maybeSingle(),
    ]);
    if (error) return { success: false, error: error.message };
    const config = parseTaxPayrollConfig(data?.value);
    if (!config.company_voen && company?.voen) {
      config.company_voen = String(company.voen).replace(/\D/g, "").slice(0, 10);
    }
    if (!data?.value && company?.vat_rate != null) {
      const vat = Number(company.vat_rate);
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

    const { data: company } = await admin.from("company_settings").select("id").limit(1).maybeSingle();
    if (company?.id) {
      await admin
        .from("company_settings")
        .update({
          voen: config.company_voen || null,
          vat_rate: vatRateToNumber(config.default_vat_rate),
        })
        .eq("id", company.id);
    }

    return { success: true, data: config };
  } catch (err) {
    return catchActionError(err, "Vergi ayarları yadda saxlanılmadı");
  }
}
