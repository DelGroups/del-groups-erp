import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface PlatformAdmin {
  userId: string;
  email: string;
  fullName: string | null;
  role: "owner" | "admin" | "support";
}

/**
 * The signed-in platform admin, checked on the server for every page and action
 * (proxy.ts only does the optimistic redirect). Anyone else is signed out and sent
 * to /login.
 */
export const requireAdmin = cache(async (): Promise<PlatformAdmin> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("platform_admins")
    .select("user_id, email, full_name, role, is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!data || !data.is_active) {
    await supabase.auth.signOut();
    redirect("/login?error=notAdmin");
  }
  return { userId: data.user_id, email: data.email, fullName: data.full_name, role: data.role };
});
