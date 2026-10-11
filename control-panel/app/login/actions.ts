"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface LoginState {
  /** i18n key under login.errors */
  error: "missingFields" | "invalidCredentials" | "notAdmin" | "failed" | null;
  email: string;
}

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "missingFields", email };

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return { error: "failed", email };
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.status === 400 ? "invalidCredentials" : "failed", email };

  // Only platform admins may stay signed in.
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (isAdmin !== true) {
    await supabase.auth.signOut();
    return { error: "notAdmin", email };
  }

  await supabase.rpc("log_platform_action", { p_action: "auth.sign_in" });
  redirect("/tenants");
}
