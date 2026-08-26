"use client";

import React from "react";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import type { PermissionKey } from "@/types/database.types";

interface PermissionGuardProps {
  permission: PermissionKey;
  children: React.ReactNode;
}

/** Blocks page content when the signed-in user lacks the required permission. */
export default function PermissionGuard({
  permission,
  children,
}: PermissionGuardProps) {
  const { loading, ready, can, user } = useAuth();
  const { t } = useI18n();

  if (loading || !ready) {
    return (
      <div className="p-12 text-center text-xs text-app-muted">
        {t("permission.checking")}
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (!can(permission)) {
    return (
      <div className="alert-warning m-6">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
        <div>
          <h2 className="alert-warning-title">{t("permission.deniedTitle")}</h2>
          <p className="alert-warning-body">{t("permission.deniedBody")}</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
