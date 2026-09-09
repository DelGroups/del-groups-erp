"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  CRM_CONFIG_KEY,
  DEFAULT_CRM_CONFIG,
  parseCrmConfig,
  type CrmConfig,
} from "@/lib/crm/config";

export function useCrmConfig(): {
  config: CrmConfig;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [config, setConfig] = useState<CrmConfig>(DEFAULT_CRM_CONFIG);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", CRM_CONFIG_KEY)
      .maybeSingle();
    if (!error) {
      setConfig(parseCrmConfig(data?.value));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { config, loading, refresh };
}
