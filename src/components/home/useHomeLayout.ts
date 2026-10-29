"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as typedClient } from "@/lib/supabase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useEnabledModules } from "@/hooks/useEnabledModules";
import { useNewUi } from "@/components/shell/NewUiProvider";
import { canViewFinancials, userHasGranularPermission } from "@/lib/auth/permissionMatrix";
import { mergeWithDefaults, type HomeLayout } from "@/lib/home/layout";
import type { HomeContext } from "@/lib/home/registry";

// The generated database types do not know the home tables yet.
const db = typedClient as unknown as SupabaseClient;

const KEY = ["home", "layouts"] as const;

/** What this user and tenant allow (registry visibility). */
export function useHomeContext(): HomeContext {
  const { profile } = useAuth();
  const { isEnabled } = useEnabledModules();
  const { newCrm } = useNewUi();
  return useMemo(
    () => ({
      isEnabled: (m: string) => isEnabled(m as Parameters<typeof isEnabled>[0]),
      can: (path: string) => userHasGranularPermission(profile, path),
      financials: canViewFinancials(profile),
      flags: { newCrm },
    }),
    [profile, isEnabled, newCrm]
  );
}

/**
 * The user's layout (public.home_layouts, own row), the company default
 * (public.home_layout_defaults) and the merged layout to show (prompt 24b). Saved in the
 * database, so it survives reloads and follows the user to another device.
 */
export function useHomeLayout() {
  const { user, isAdmin } = useAuth();
  const ctx = useHomeContext();
  const client = useQueryClient();
  const userId = user?.id ?? null;

  const rows = useQuery({
    queryKey: [...KEY, userId],
    enabled: !!userId,
    queryFn: async () => {
      const [own, company] = await Promise.all([
        db.from("home_layouts").select("layout").eq("user_id", userId).maybeSingle(),
        db.from("home_layout_defaults").select("layout").maybeSingle(),
      ]);
      // Before the migration runs the tables do not exist: the built-in default is used.
      return { own: own.error ? null : (own.data?.layout ?? null), company: company.error ? null : (company.data?.layout ?? null) };
    },
    staleTime: 5 * 60_000,
  });

  const merged = useMemo(() => mergeWithDefaults(rows.data?.own ?? null, rows.data?.company ?? null, ctx), [rows.data, ctx]);
  const fallback = useMemo(() => mergeWithDefaults(null, rows.data?.company ?? null, ctx).layout, [rows.data, ctx]);

  const save = useMutation({
    mutationFn: async (layout: HomeLayout) => {
      const { error } = await db.from("home_layouts").upsert({ user_id: userId, layout }, { onConflict: "user_id" });
      if (error) throw new Error(error.message);
    },
    onSettled: () => client.invalidateQueries({ queryKey: KEY }),
  });

  const saveCompanyDefault = useMutation({
    mutationFn: async (layout: HomeLayout) => {
      const { error } = await db.from("home_layout_defaults").upsert({ id: true, layout }, { onConflict: "id" });
      if (error) throw new Error(error.message);
    },
    onSettled: () => client.invalidateQueries({ queryKey: KEY }),
  });

  /** Back to the company default (or the built-in one): the user's own row is deleted. */
  const reset = useMutation({
    mutationFn: async () => {
      const { error } = await db.from("home_layouts").delete().eq("user_id", userId);
      if (error) throw new Error(error.message);
    },
    onSettled: () => client.invalidateQueries({ queryKey: KEY }),
  });

  return { ready: rows.isSuccess || rows.isError, layout: merged.layout, source: merged.source, defaultLayout: fallback, ctx, isAdmin, save, saveCompanyDefault, reset };
}
