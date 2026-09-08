"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export function useVatAccountIds(): ReadonlySet<string> {
  const [vatAccountIds, setVatAccountIds] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    void supabase
      .from("accounts")
      .select("id, is_vat_account")
      .eq("is_vat_account", true)
      .then(({ data }) => {
        const ids = new Set(
          (data || [])
            .map((row) => (typeof row.id === "string" ? row.id : ""))
            .filter(Boolean)
        );
        setVatAccountIds(ids);
      });
  }, []);

  return vatAccountIds;
}
