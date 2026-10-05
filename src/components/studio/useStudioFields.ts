"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { parseStudioField, type StudioField, type StudioModelKey } from "@/lib/studio/fields";

/**
 * Active Studio fields of one model, in display order.
 * Returns [] while loading, when none are defined, or when the Studio migration
 * has not been applied yet, so forms render exactly as before.
 */
export function useStudioFields(modelKey: StudioModelKey): { fields: StudioField[]; loading: boolean } {
  const [fields, setFields] = useState<StudioField[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // studio_fields is not in the generated DB types yet.
    void (supabase as unknown as SupabaseClient)
      .from("studio_fields")
      .select("id, model_key, name, label, field_type, options, required, show_in_list, help, sequence, active")
      .eq("model_key", modelKey)
      .eq("active", true)
      .order("sequence")
      .order("created_at")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setFields([]);
        } else {
          setFields(
            (data || [])
              .map((row) => parseStudioField(row as Record<string, unknown>))
              .filter((field): field is StudioField => Boolean(field))
          );
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [modelKey]);

  return { fields, loading };
}
