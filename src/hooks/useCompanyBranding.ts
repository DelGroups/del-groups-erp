"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  DEFAULT_COMPANY_BRANDING,
  type CompanyBranding,
} from "@/lib/print/types";

export function useCompanyBranding(): CompanyBranding {
  const [branding, setBranding] = useState<CompanyBranding>(DEFAULT_COMPANY_BRANDING);

  useEffect(() => {
    void (async () => {
      const [{ data: settings }, { data: company }] = await Promise.all([
        supabase
          .from("settings")
          .select("company_name, logo_url, voen, address, phone")
          .limit(1)
          .maybeSingle(),
        supabase.from("company_settings").select("*").limit(1).maybeSingle(),
      ]);

      setBranding({
        companyName:
          company?.company_name ||
          settings?.company_name ||
          DEFAULT_COMPANY_BRANDING.companyName,
        logoUrl: settings?.logo_url || null,
        voen: company?.voen || settings?.voen || null,
        address: company?.address || settings?.address || null,
        phone: company?.phone || settings?.phone || null,
        email: company?.email || null,
        bankName: company?.bank_name || null,
        iban: company?.iban || null,
      });
    })();
  }, []);

  return branding;
}
