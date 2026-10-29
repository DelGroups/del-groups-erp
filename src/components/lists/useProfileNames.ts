"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSupabaseClient } from "@/lib/supabase";
import { fetchProfileDisplayNames, type ProfileNamesClient } from "@/lib/profiles/displayNames";
import { useListColumnsEnabled } from "./ListColumnsFlag";

const NO_NAMES: ReadonlyMap<string, string> = new Map();

/**
 * Names of the given user ids (prompt 24c, "Created by"), for classic lists whose rows carry only
 * the id. One batched lookup per distinct id set, and only while LIST_COLUMNS is on (the column
 * does not exist otherwise).
 */
export function useProfileNames(ids: readonly (string | null | undefined)[]): ReadonlyMap<string, string> {
  const enabled = useListColumnsEnabled();
  const key = useMemo(() => [...new Set(ids.filter((id): id is string => typeof id === "string" && !!id))].sort(), [ids]);
  const query = useQuery({
    queryKey: ["profile-names", key.join(",")],
    enabled: enabled && key.length > 0,
    staleTime: 5 * 60_000,
    queryFn: () => fetchProfileDisplayNames(getSupabaseClient() as unknown as ProfileNamesClient, key),
  });
  return query.data ?? NO_NAMES;
}
