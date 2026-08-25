import type { EmailOtpType, Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type CapturedAuthParams = {
  hasTokens: boolean;
  code: string | null;
  tokenHash: string | null;
  type: EmailOtpType | null;
  accessToken: string | null;
  refreshToken: string | null;
};

/** Reads invite/recovery auth params from the current URL (hash + query). */
export function readAuthParamsFromUrl(url: string = window.location.href): CapturedAuthParams {
  const parsed = new URL(url);
  const search = parsed.searchParams;
  const hash = parsed.hash.replace(/^#/, "");
  const hashParams = hash ? new URLSearchParams(hash) : null;

  const code = search.get("code");
  const tokenHash = search.get("token_hash");
  const type = search.get("type") as EmailOtpType | null;
  const accessToken = hashParams?.get("access_token") ?? null;
  const refreshToken = hashParams?.get("refresh_token") ?? null;

  const hasTokens = Boolean(
    code || tokenHash || (accessToken && refreshToken)
  );

  return {
    hasTokens,
    code,
    tokenHash,
    type,
    accessToken,
    refreshToken,
  };
}

/** Removes auth tokens from the address bar after a session is established. */
export function clearAuthParamsFromUrl(): void {
  if (typeof window === "undefined") return;
  window.history.replaceState(null, "", window.location.pathname);
}

async function applyAuthParams(params: CapturedAuthParams): Promise<Session | null> {
  if (params.code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(params.code);
    if (error) {
      console.error("[auth] exchangeCodeForSession failed:", error.message);
      return null;
    }
    clearAuthParamsFromUrl();
    return data.session;
  }

  if (params.tokenHash && params.type) {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: params.tokenHash,
      type: params.type,
    });
    if (error) {
      console.error("[auth] verifyOtp failed:", error.message);
      return null;
    }
    clearAuthParamsFromUrl();
    return data.session;
  }

  if (params.accessToken && params.refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: params.accessToken,
      refresh_token: params.refreshToken,
    });
    if (error) {
      console.error("[auth] setSession failed:", error.message);
      return null;
    }
    clearAuthParamsFromUrl();
    return data.session;
  }

  return null;
}

/**
 * Clears any existing browser session, then establishes a fresh session
 * exclusively from invite/recovery tokens in the current URL.
 * Never reuses a pre-existing logged-in session (e.g. an admin's).
 */
export async function establishInviteSession(
  url: string = window.location.href
): Promise<Session | null> {
  const params = readAuthParamsFromUrl(url);

  // Capture tokens before sign-out; then discard any stale session.
  await supabase.auth.signOut();

  if (!params.hasTokens) {
    console.warn("[auth] No invite/recovery tokens found in URL after sign-out");
    return null;
  }

  const session = await applyAuthParams(params);
  if (session) {
    console.info("[auth] Invite/recovery session established for:", session.user.email);
  }
  return session;
}

/** @deprecated Use `establishInviteSession` for invite/set-password flows. */
export async function waitForAuthSession(options?: {
  timeoutMs?: number;
  clearExistingSession?: boolean;
}): Promise<Session | null> {
  if (options?.clearExistingSession !== false) {
    return establishInviteSession();
  }

  const params = readAuthParamsFromUrl();
  if (params.hasTokens) {
    return applyAuthParams(params);
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
}
