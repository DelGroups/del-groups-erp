"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Lock, LogIn, Mail, TriangleAlert } from "lucide-react";
import LanguageSwitcher from "@/components/i18n/LanguageSwitcher";
import ThemeSwitcher from "@/components/theme/ThemeSwitcher";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase, getSupabaseClientInfo } from "@/lib/supabase";

function mapLoginError(
  message: string,
  t: (key: string) => string
): string {
  switch (message) {
    case "Invalid login credentials":
      return t("auth.invalidCredentials");
    case "Email not confirmed":
      return t("auth.emailNotConfirmed");
    case "Too many requests":
      return t("auth.tooManyRequests");
    case "Failed to fetch":
      return t("auth.networkError");
    case "account_inactive":
      return t("auth.accountInactive");
    default:
      return message;
  }
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const nextPath = searchParams.get("next") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(() => {
    const param = searchParams.get("error");
    return param ? mapLoginError(param, t) : "";
  });
  const [submitting, setSubmitting] = useState(false);
  const supabaseInfo = getSupabaseClientInfo();
  const configError = (() => {
    if (supabaseInfo.isConfigured) return "";
    if (supabaseInfo.configIssue === "bad_url") return t("auth.envBadUrl");
    if (supabaseInfo.configIssue === "bad_key") return t("auth.envBadKey");
    return t("auth.envNotConfigured");
  })();

  useEffect(() => {
    if (!supabaseInfo.isConfigured) return;
    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) router.replace(nextPath);
    });
  }, [nextPath, router, supabaseInfo.isConfigured]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    if (!getSupabaseClientInfo().isConfigured) {
      console.error("[login] Supabase env invalid:", getSupabaseClientInfo());
      setError(configError);
      setSubmitting(false);
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (signInError) {
        console.error("[login] signInWithPassword failed:", {
          message: signInError.message,
          status: signInError.status,
          code: signInError.code,
          email: normalizedEmail,
          supabase: getSupabaseClientInfo(),
        });
        setError(mapLoginError(signInError.message, t));
        return;
      }

      if (!data.session || !data.user) {
        console.error("[login] No session returned after sign-in:", data);
        setError(t("auth.sessionFailed"));
        return;
      }

      console.info("[login] Session established:", {
        userId: data.user.id,
        email: data.user.email,
        expiresAt: data.session.expires_at,
      });

      const {
        data: { session: verifiedSession },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !verifiedSession) {
        console.error("[login] getSession after sign-in failed:", sessionError?.message);
        setError(t("auth.sessionStorageFailed"));
        return;
      }

      console.info("[login] Session verified in client storage for:", verifiedSession.user.email);

      router.replace(nextPath);
      router.refresh();
    } catch (err) {
      console.error("[login] Network/fetch error during signInWithPassword:", err);
      console.error("[login] Error details:", {
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : undefined,
        stack: err instanceof Error ? err.stack : undefined,
        cause: err instanceof Error ? err.cause : undefined,
        supabase: getSupabaseClientInfo(),
      });
      setError(
        mapLoginError(err instanceof Error ? err.message : "Failed to fetch", t)
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="app-card app-card-elevated w-full max-w-sm space-y-4 p-7"
    >
      <div className="space-y-1 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-app-accent">
          <Building2 className="h-6 w-6 text-white" />
        </div>
        <h1 className="pt-2 text-base font-bold text-app">DEL GROUPS MMC</h1>
        <p className="text-[11px] text-app-muted">{t("auth.loginTitle")}</p>
      </div>

      {configError && !error && (
        <div className="badge-danger flex items-start gap-2 rounded-xl p-3 text-[11px] font-semibold">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {configError}
        </div>
      )}

      {error && (
        <div className="badge-danger flex items-start gap-2 rounded-xl p-3 text-[11px] font-semibold">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <label className="app-label">
        {t("auth.email")}
        <div className="relative mt-1">
          <Mail className="absolute left-3 top-2.5 h-4 w-4 text-app-muted" />
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ad@delgroups.az"
            className="app-input py-2 pl-9 pr-3 text-sm"
          />
        </div>
      </label>

      <label className="app-label">
        {t("auth.password")}
        <div className="relative mt-1">
          <Lock className="absolute left-3 top-2.5 h-4 w-4 text-app-muted" />
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="app-input py-2 pl-9 pr-3 text-sm"
          />
        </div>
      </label>

      <div className="text-right">
        <Link
          href="/forgot-password"
          className="text-[11px] font-semibold text-app-accent hover:opacity-80"
        >
          {t("auth.forgotPassword")}
        </Link>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="btn-primary w-full justify-center py-2.5 disabled:opacity-60"
      >
        <LogIn className="h-4 w-4" />
        {submitting ? t("auth.signingIn") : t("auth.signIn")}
      </button>

      <p className="text-center text-[10px] leading-relaxed text-app-muted">
        {t("auth.noAccount")}
      </p>
    </form>
  );
}

export default function LoginPage() {
  const { t } = useI18n();

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-app p-4">
      <div className="absolute right-4 top-4 flex w-36 flex-col gap-2">
        <ThemeSwitcher compact />
        <LanguageSwitcher compact />
      </div>
      <Suspense
        fallback={
          <div className="text-xs text-app-muted">{t("common.loading")}</div>
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
