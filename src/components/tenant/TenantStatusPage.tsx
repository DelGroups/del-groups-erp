"use client";

import React from "react";
import { Building2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

export type TenantStatusKind = "notFound" | "suspended" | "preparing" | "unavailable";

/**
 * Shown by src/proxy.ts (via a rewrite, URL unchanged) when the request's domain has no
 * tenant, or the tenant is suspended, being prepared, or the control plane is unreachable.
 */
export default function TenantStatusPage({ kind }: { kind: TenantStatusKind }) {
  const { t } = useI18n();
  const canRetry = kind === "preparing" || kind === "unavailable";

  return (
    <main className="flex min-h-screen items-center justify-center bg-app p-6">
      <div className="app-card app-card-elevated max-w-md space-y-4 p-8 text-center">
        <Building2 className="mx-auto h-12 w-12 text-app-muted" aria-hidden />
        <h1 className="text-lg font-bold text-app">{t(`tenantStatus.${kind}.title`)}</h1>
        <p className="text-sm text-app-muted">{t(`tenantStatus.${kind}.body`)}</p>
        {canRetry ? (
          <button type="button" className="btn-primary inline-flex px-4 py-2 text-sm" onClick={() => window.location.reload()}>
            {t("tenantStatus.retry")}
          </button>
        ) : null}
      </div>
    </main>
  );
}
