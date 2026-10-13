"use client";

import { useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import { formatBytesShort, worstLimit, type LimitKind, type TenantLimitStatus } from "@/lib/limits/limits";
import { useLimitStatus } from "./useLimitStatus";

const KEYS: Record<LimitKind, { warning: string; blocked: string }> = {
  users: { warning: "limits.bannerUsersWarning", blocked: "limits.bannerUsersBlocked" },
  storage: { warning: "limits.bannerStorageWarning", blocked: "limits.bannerStorageBlocked" },
  ai: { warning: "limits.bannerAiWarning", blocked: "limits.bannerAiBlocked" },
};

function figures(kind: LimitKind, status: TenantLimitStatus) {
  const u = status[kind];
  if (kind === "storage") return { used: formatBytesShort(u.used), limit: u.limit === null ? "∞" : formatBytesShort(u.limit) };
  if (kind === "ai") return { used: u.used.toFixed(2), limit: u.limit === null ? "∞" : u.limit.toFixed(2) };
  return { used: u.used, limit: u.limit ?? "∞" };
}

/**
 * Plan-limit banner (prompt 12): from 80 % a warning, at 100 % what is paused. Mounted only
 * in multi-tenant mode (root layout); renders nothing while every limit is below 80 % or
 * unlimited. Seat warnings only for people who manage users.
 */
export default function LimitBanner() {
  const { t } = useI18n();
  const { user, can } = useAuth();
  const { status } = useLimitStatus(Boolean(user));
  const [dismissed, setDismissed] = useState(false);
  if (!status || dismissed) return null;

  const visible: TenantLimitStatus = can("can_manage_users") ? status : { ...status, users: { used: 0, limit: null } };
  const worst = worstLimit(visible);
  if (!worst) return null;

  const blocked = worst.state === "blocked";
  return (
    <div
      role="status"
      className={`flex items-center justify-center gap-3 px-4 py-2 text-center text-sm font-semibold ${blocked ? "bg-rose-600 text-white" : "bg-amber-100 text-amber-900"}`}
    >
      <span>{t(KEYS[worst.kind][worst.state], figures(worst.kind, visible))}</span>
      <button type="button" onClick={() => setDismissed(true)} className="rounded px-2 text-xs underline">
        {t("limits.dismiss")}
      </button>
    </div>
  );
}
