"use client";

import React, { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/i18n/I18nProvider";

function AuthCallbackContent() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/auth/set-password";

  useEffect(() => {
    // Never establish a session here — forward all auth params + hash to the
    // target page so it can signOut() and bind the invited user's session.
    const forward = new URL(next, window.location.origin);
    searchParams.forEach((value, key) => {
      if (key !== "next") forward.searchParams.set(key, value);
    });
    const destination = `${forward.pathname}${forward.search}${window.location.hash}`;

    if (window.location.hash || forward.searchParams.has("code") || forward.searchParams.has("token_hash")) {
      window.location.replace(destination);
      return;
    }

    router.replace(
      `/login?error=${encodeURIComponent(t("auth.invalidInviteCallback"))}`
    );
  }, [next, router, searchParams, t]);

  return (
    <div className="flex min-h-screen items-center justify-center text-xs text-app-muted">
      {t("auth.checkingInviteLink")}
    </div>
  );
}

export default function AuthCallbackPage() {
  const { t } = useI18n();

  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-xs text-app-muted">
          {t("common.loading")}
        </div>
      }
    >
      <AuthCallbackContent />
    </Suspense>
  );
}
