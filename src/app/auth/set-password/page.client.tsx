"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, KeyRound, Lock, Mail, TriangleAlert } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/lib/supabase";
import { establishInviteSession } from "@/lib/auth/inviteSession";

export default function SetPasswordPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    void (async () => {
      const session = await establishInviteSession();
      if (!active) return;

      if (!session?.user.email) {
        setHasSession(false);
        setCheckingSession(false);
        return;
      }

      setHasSession(true);
      setEmail(session.user.email);
      if (session.user.user_metadata?.full_name) {
        setFullName(String(session.user.user_metadata.full_name));
      }
      setCheckingSession(false);
    })();

    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError(t("auth.passwordMinLength"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("auth.passwordsMismatch"));
      return;
    }

    setSubmitting(true);
    setError("");

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setError(t("auth.sessionNotFoundInvite"));
      setSubmitting(false);
      return;
    }

    const trimmedName = fullName.trim();
    const { data, error: updateError } = await supabase.auth.updateUser({
      password,
      ...(trimmedName ? { data: { full_name: trimmedName } } : {}),
    });

    if (updateError) {
      setError(updateError.message);
      setSubmitting(false);
      return;
    }

    if (data.user && trimmedName) {
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ full_name: trimmedName, updated_at: new Date().toISOString() })
        .eq("id", data.user.id);

      if (profileError) {
        console.warn("Profile update failed:", profileError.message);
      }
    }

    router.replace("/");
    router.refresh();
  };

  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center text-xs text-app-muted">
        {t("auth.checkingInviteLink")}
      </div>
    );
  }

  if (!hasSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app p-4">
        <div className="w-full max-w-sm space-y-3 rounded-2xl app-card p-7 text-center shadow-sm">
          <TriangleAlert className="mx-auto h-7 w-7 text-amber-500" />
          <h1 className="text-sm font-bold text-app">{t("auth.invalidLinkTitle")}</h1>
          <p className="text-[11px] text-app-muted">{t("auth.invalidInviteLinkBody")}</p>
          <Link
            href="/login"
            className="inline-block rounded-xl bg-[image:var(--app-gradient)] px-5 py-2 text-xs font-semibold text-white hover:brightness-110"
          >
            {t("auth.loginPage")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-app p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-2xl app-card p-7 shadow-sm"
      >
        <div className="space-y-1 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-600">
            <KeyRound className="h-5 w-5 text-white" />
          </div>
          <h1 className="pt-2 text-base font-bold text-app">{t("auth.setPasswordTitle")}</h1>
          <p className="text-[11px] text-app-muted">{t("auth.setPasswordSubtitle")}</p>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl alert-danger rounded-xl p-3 text-[11px] font-semibold">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            {error}
          </div>
        )}

        <label className="block text-xs font-semibold text-app">
          {t("auth.email")}
          <div className="relative mt-1">
            <Mail className="absolute left-3 top-2.5 h-4 w-4 text-app-muted" />
            <input
              type="email"
              value={email}
              readOnly
              disabled
              className="w-full cursor-not-allowed rounded-lg border border-app bg-app-card-hover py-2 pl-9 pr-3 text-sm text-app-muted"
            />
          </div>
          <p className="mt-1 text-[10px] font-normal text-app-muted">{t("auth.emailHint")}</p>
        </label>

        <label className="block text-xs font-semibold text-app">
          {t("auth.fullName")}
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder={t("auth.fullName")}
            className="mt-1 w-full rounded-lg border border-app px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </label>

        <label className="block text-xs font-semibold text-app">
          {t("auth.newPassword")}
          <div className="relative mt-1">
            <Lock className="absolute left-3 top-2.5 h-4 w-4 text-app-muted" />
            <input
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-app py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </label>

        <label className="block text-xs font-semibold text-app">
          {t("auth.passwordRepeat")}
          <div className="relative mt-1">
            <Lock className="absolute left-3 top-2.5 h-4 w-4 text-app-muted" />
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-lg border border-app py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </label>

        <button
          type="submit"
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
        >
          <CheckCircle2 className="h-4 w-4" />
          {submitting ? t("auth.saving") : t("auth.setPasswordAndContinue")}
        </button>
      </form>
    </div>
  );
}
