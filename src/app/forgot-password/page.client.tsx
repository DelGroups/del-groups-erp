"use client";

import React, { Suspense, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Mail, TriangleAlert } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/lib/supabase";

function ForgotPasswordForm() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess(false);

    const normalizedEmail = email.trim().toLowerCase();
    const redirectTo = `${window.location.origin}/update-password`;

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo,
    });

    if (resetError) {
      console.error("[forgot-password] resetPasswordForEmail error:", {
        message: resetError.message,
        status: resetError.status,
        code: resetError.code,
      });
      setError(resetError.message);
      setSubmitting(false);
      return;
    }

    console.info("[forgot-password] Reset email requested for:", normalizedEmail);
    setSuccess(true);
    setSubmitting(false);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-sm space-y-4 rounded-2xl app-card p-7 shadow-sm"
    >
      <div className="space-y-1 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600">
          <Mail className="h-5 w-5 text-white" />
        </div>
        <h1 className="pt-2 text-base font-bold text-app">{t("auth.forgotPassword")}</h1>
        <p className="text-[11px] text-app-muted">{t("auth.forgotPasswordSubtitle")}</p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-[11px] font-semibold text-rose-800">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          {error}
        </div>
      )}

      {success && (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[11px] font-semibold text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          {t("auth.resetLinkSent")}
        </div>
      )}

      <label className="block text-xs font-semibold text-app">
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
            disabled={success}
            className="w-full rounded-lg border border-app py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--app-accent-ring)] disabled:bg-app-card-hover"
          />
        </div>
      </label>

      <button
        type="submit"
        disabled={submitting || success}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
      >
        {submitting ? t("auth.sending") : t("auth.sendResetLink")}
      </button>

      <Link
        href="/login"
        className="flex items-center justify-center gap-1 text-[11px] font-semibold text-app-muted hover:text-app-accent"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t("auth.backToLogin")}
      </Link>
    </form>
  );
}

export default function ForgotPasswordPage() {
  const { t } = useI18n();

  return (
    <div className="flex min-h-screen items-center justify-center bg-app p-4">
      <Suspense fallback={<div className="text-xs text-app-muted">{t("common.loading")}</div>}>
        <ForgotPasswordForm />
      </Suspense>
    </div>
  );
}
