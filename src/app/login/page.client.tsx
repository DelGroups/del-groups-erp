"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, LogIn, Mail, TriangleAlert } from "lucide-react";
import LanguageSwitcher from "@/components/i18n/LanguageSwitcher";
import ThemeSwitcher from "@/components/theme/ThemeSwitcher";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase, ensureSupabaseReady, getSupabaseClientInfo } from "@/lib/supabase";
import type { SupabaseConfigIssue } from "@/lib/env";

const DEFAULT_COMPANY_NAME = "DEL GROUPS MMC";

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
    case "no_profile":
      return t("auth.noProfile");
    default:
      return message;
  }
}

function CompanyLogo({
  logoUrl,
  companyName,
}: {
  logoUrl: string;
  companyName: string;
}) {
  const [imgError, setImgError] = useState(false);
  const showImage = Boolean(logoUrl) && !imgError;

  if (showImage) {
    return (
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl border border-app bg-app-card p-2 shadow-md backdrop-blur-md">
        <img
          src={logoUrl}
          alt={`${companyName} logo`}
          className="h-full w-full object-contain"
          onError={() => setImgError(true)}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl border border-app bg-[image:var(--app-gradient)] shadow-lg shadow-indigo-500/25">
      <span className="text-2xl font-bold tracking-widest text-white">DG</span>
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const nextPath = searchParams.get("next") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState(DEFAULT_COMPANY_NAME);
  const [logoUrl, setLogoUrl] = useState("");
  const [error, setError] = useState(() => {
    const param = searchParams.get("error");
    return param ? mapLoginError(param, t) : "";
  });
  const [submitting, setSubmitting] = useState(false);
  const [configReady, setConfigReady] = useState(() => getSupabaseClientInfo().isConfigured);
  const [configIssue, setConfigIssue] = useState<SupabaseConfigIssue>(
    () => getSupabaseClientInfo().configIssue
  );

  useEffect(() => {
    void ensureSupabaseReady().then((ready) => {
      setConfigReady(ready);
      setConfigIssue(getSupabaseClientInfo().configIssue);
    });
  }, []);

  useEffect(() => {
    if (!configReady) return;

    void supabase
      .from("settings")
      .select("company_name, logo_url")
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data?.company_name) setCompanyName(data.company_name);
        if (data?.logo_url) setLogoUrl(data.logo_url);
      });

    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) router.replace(nextPath);
    });
  }, [nextPath, router, configReady]);

  const configError = (() => {
    if (configReady) return "";
    if (configIssue === "bad_url") return t("auth.envBadUrl");
    if (configIssue === "bad_key") return t("auth.envBadKey");
    return t("auth.envNotConfigured");
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    const ready = await ensureSupabaseReady();
    setConfigReady(ready);
    setConfigIssue(getSupabaseClientInfo().configIssue);

    if (!ready) {
      console.error("[login] Supabase env invalid:", getSupabaseClientInfo());
      setError(configError || t("auth.envNotConfigured"));
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

  const inputClassName =
    "app-input w-full py-3 pl-11 pr-4 text-sm";

  return (
    <form
      onSubmit={handleSubmit}
      className="app-glass relative w-full max-w-[420px] overflow-hidden rounded-2xl p-8 shadow-md"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-indigo-500/15 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-20 -left-16 h-44 w-44 rounded-full bg-cyan-500/10 blur-3xl"
      />

      <div className="relative space-y-2 text-center">
        <CompanyLogo logoUrl={logoUrl} companyName={companyName} />
        <h1 className="pt-3 text-xl font-bold tracking-[0.18em] text-app">
          {companyName}
        </h1>
        <p className="text-xs font-medium tracking-wide text-app-muted">
          {t("auth.loginTitle")}
        </p>
      </div>

      <div className="relative mt-7 space-y-5">
        {configError && !error && (
          <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-[11px] font-medium leading-relaxed text-rose-400 backdrop-blur-sm">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {configError}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-[11px] font-medium leading-relaxed text-rose-400 backdrop-blur-sm">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <label className="app-label">
          {t("auth.email")}
          <div className="relative mt-2">
            <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-app-muted" />
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ad@delgroups.az"
              className={inputClassName}
            />
          </div>
        </label>

        <label className="app-label">
          {t("auth.password")}
          <div className="relative mt-2">
            <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-app-muted" />
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className={inputClassName}
            />
          </div>
        </label>

        <div className="text-right">
          <Link
            href="/forgot-password"
            className="text-[11px] font-semibold text-app-accent transition-colors hover:underline"
          >
            {t("auth.forgotPassword")}
          </Link>
        </div>

        <button type="submit" disabled={submitting} className="btn-primary w-full py-3 text-sm">
          <LogIn className="h-4 w-4" />
          {submitting ? t("auth.signingIn") : t("auth.signIn")}
        </button>

        <p className="text-center text-[10px] leading-relaxed text-app-muted">
          {t("auth.noAccount")}
        </p>
      </div>
    </form>
  );
}

export default function LoginPage() {
  const { t } = useI18n();

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-app p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute -left-[10%] -top-[20%] h-[55%] w-[55%] rounded-full bg-indigo-500/15 blur-[120px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-[5%] top-[10%] h-[45%] w-[50%] rounded-full bg-cyan-500/12 blur-[100px]"
      />

      <div className="absolute right-4 top-4 z-20 w-52 space-y-2">
        <ThemeSwitcher />
        <LanguageSwitcher compact />
      </div>

      <Suspense
        fallback={
          <div className="relative z-10 text-xs text-app-muted">{t("common.loading")}</div>
        }
      >
        <div className="relative z-10 w-full max-w-[420px]">
          <LoginForm />
        </div>
      </Suspense>
    </div>
  );
}
