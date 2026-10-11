"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isLocale } from "@/lib/i18n/messages";
import { LOCALE_COOKIE } from "@/lib/i18n/server";

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  // Written while the session is still valid; ignored if it is already gone.
  await supabase.rpc("log_platform_action", { p_action: "auth.sign_out" });
  await supabase.auth.signOut();
  redirect("/login");
}

export async function setLocale(formData: FormData): Promise<void> {
  const locale = formData.get("locale");
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
}
