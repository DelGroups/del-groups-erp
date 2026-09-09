"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  BARCODE_LABEL_CONFIG_KEY,
  DEFAULT_BARCODE_LABEL_CONFIG,
  parseBarcodeLabelConfig,
  type BarcodeLabelConfig,
} from "@/lib/barcode/labelConfig";

export function useBarcodeLabelConfig(): {
  config: BarcodeLabelConfig;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [config, setConfig] = useState<BarcodeLabelConfig>(DEFAULT_BARCODE_LABEL_CONFIG);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", BARCODE_LABEL_CONFIG_KEY)
      .maybeSingle();
    if (!error) {
      setConfig(parseBarcodeLabelConfig(data?.value));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { config, loading, refresh };
}
