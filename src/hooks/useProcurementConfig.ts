"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  DEFAULT_PROCUREMENT_CONFIG,
  PROCUREMENT_CONFIG_KEY,
  parseProcurementConfig,
  type ProcurementConfig,
} from "@/lib/procurement/config";

export function useProcurementConfig(): {
  config: ProcurementConfig;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [config, setConfig] = useState<ProcurementConfig>(DEFAULT_PROCUREMENT_CONFIG);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", PROCUREMENT_CONFIG_KEY)
      .maybeSingle();
    if (!error) {
      setConfig(parseProcurementConfig(data?.value));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { config, loading, refresh };
}
