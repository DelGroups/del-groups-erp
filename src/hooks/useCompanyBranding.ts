"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { CompanyBranding } from "@/lib/print/types";
import { useCompanyProfile } from "@/hooks/useCompanyProfile";
import {
  TAX_PAYROLL_CONFIG_KEY,
  parseTaxPayrollConfig,
} from "@/lib/tax/payrollConfig";

/** Company details for printed documents (Settings → Company). */
export function useCompanyBranding(): CompanyBranding {
  const company = useCompanyProfile();
  const [taxVoen, setTaxVoen] = useState<string | null>(null);

  useEffect(() => {
    void supabase
      .from("system_settings")
      .select("value")
      .eq("key", TAX_PAYROLL_CONFIG_KEY)
      .maybeSingle()
      .then(({ data }) => setTaxVoen(parseTaxPayrollConfig(data?.value).company_voen || null));
  }, []);

  const { profile, legalName } = company;
  return useMemo(
    () => ({
      companyName: legalName,
      logoUrl: profile.logoUrl || null,
      // The VÖEN on the tax settings page wins, as before.
      voen: taxVoen || profile.voen || null,
      address: profile.address || null,
      phone: profile.phone || null,
      email: profile.email || null,
      bankName: profile.bankName || null,
      iban: profile.iban || null,
    }),
    [legalName, profile, taxVoen]
  );
}
