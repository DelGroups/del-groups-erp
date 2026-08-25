"use server";

import { cookies } from "next/headers";
import { createSupabaseServerClient, getServerAuthContext } from "@/lib/supabaseServer";
import { ActionAuthError } from "@/lib/auth/serverActionAuth";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from "@/i18n/types";
import type { Locale } from "@/i18n/types";

export type UpdateLocaleResult =
  | { success: true; locale: Locale }
  | { success: false; error: string };

export async function updateUserLocaleAction(
  locale: string
): Promise<UpdateLocaleResult> {
  try {
    if (!isLocale(locale)) {
      return { success: false, error: "Invalid locale" };
    }

    const { user } = await getServerAuthContext();
    if (!user) {
      return { success: false, error: "Authentication required" };
    }

    const client = await createSupabaseServerClient();
    const { error } = await client
      .from("profiles")
      .update({ locale, updated_at: new Date().toISOString() })
      .eq("id", user.id);

    if (error) {
      return { success: false, error: error.message };
    }

    const cookieStore = await cookies();
    cookieStore.set(LOCALE_COOKIE, locale, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });

    return { success: true, locale };
  } catch (err) {
    if (err instanceof ActionAuthError) {
      return { success: false, error: err.message };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Locale update failed",
    };
  }
}

export async function setGuestLocaleCookie(locale: string): Promise<void> {
  if (!isLocale(locale)) return;
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}

export async function getInitialLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;

  try {
    const client = await createSupabaseServerClient();
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user) return DEFAULT_LOCALE;

    const { data } = await client
      .from("profiles")
      .select("locale")
      .eq("id", user.id)
      .maybeSingle();

    const profileLocale = data?.locale;
    if (isLocale(profileLocale)) return profileLocale;
  } catch {
    // fall through
  }

  return DEFAULT_LOCALE;
}
