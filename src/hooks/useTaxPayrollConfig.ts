"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  TAX_PAYROLL_CONFIG_KEY,
  DEFAULT_TAX_PAYROLL_CONFIG,
  parseTaxPayrollConfig,
  type TaxPayrollConfig,
} from "@/lib/tax/payrollConfig";

export function useTaxPayrollConfig(): {
  config: TaxPayrollConfig;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [config, setConfig] = useState<TaxPayrollConfig>(DEFAULT_TAX_PAYROLL_CONFIG);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", TAX_PAYROLL_CONFIG_KEY)
      .maybeSingle();
    if (!error) {
      setConfig(parseTaxPayrollConfig(data?.value));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { config, loading, refresh };
}
