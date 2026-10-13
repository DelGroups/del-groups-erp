/**
 * Browser side of the storage limit (prompt 12). Uploads from the browser are stopped by the
 * restrictive policy storage_quota_insert; after a failed upload this tells whether that
 * was the reason, so the user sees the plan message instead of a policy error.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getMessages } from "@/i18n/messages";
import { translate } from "@/i18n/translate";
import { LOCALE_COOKIE, resolveLocale } from "@/i18n/types";
import { limitState, parseLimitStatus } from "./limits";

function browserLocale() {
  if (typeof document === "undefined") return resolveLocale(null);
  const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`));
  return resolveLocale(match ? decodeURIComponent(match[1]) : null);
}

/** The plan message when the tenant's storage is full, else null. Never throws. */
export async function storageFullMessage(client: SupabaseClient): Promise<string | null> {
  try {
    const { data, error } = await client.rpc("tenant_limit_status");
    if (error) return null;
    if (limitState(parseLimitStatus(data).storage) !== "blocked") return null;
    return translate(getMessages(browserLocale()), "limits.storageFull");
  } catch {
    return null;
  }
}
