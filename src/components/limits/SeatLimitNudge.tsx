"use client";

import { useState } from "react";
import { Users, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { limitState, percentUsed, type LimitUsage } from "@/lib/limits/limits";

/**
 * Seat-limit nudge on the users page (prompt 12; design reference
 * cta/cta-seat-limit-collaboration-nudge): seats used, a progress bar and what to do.
 * Shown from 80 % of the plan's seats; nothing without a seat limit.
 */
export default function SeatLimitNudge({ users, onReview }: { users: LimitUsage; onReview: () => void }) {
  const { t } = useI18n();
  const [dismissed, setDismissed] = useState(false);
  const state = limitState(users);
  if (dismissed || users.limit === null || (state !== "warning" && state !== "blocked")) return null;

  const full = state === "blocked";
  const left = Math.max(0, users.limit - users.used);
  const pct = percentUsed(users);

  return (
    <section
      role="status"
      aria-live="polite"
      className={`app-card relative flex flex-col gap-3 p-4 motion-safe:transition-opacity ${full ? "alert-warning" : ""}`}
    >
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="btn-ghost absolute right-2 top-2 rounded-lg p-1"
        aria-label={t("limits.dismiss")}
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-center gap-3 pr-8">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <Users className="h-4 w-4" />
        </span>
        <div>
          <p className="text-sm font-bold">{full ? t("limits.seatsFull") : t("limits.seatsAlmost", { left })}</p>
          <p className="text-xs text-app-muted">{t("limits.seatsTitle", { used: users.used, limit: users.limit })}</p>
        </div>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={users.limit}
        aria-valuenow={users.used}
        aria-label={t("limits.seatsTitle", { used: users.used, limit: users.limit })}
      >
        <div
          className={`h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500 ${full ? "bg-rose-500" : "bg-amber-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-app-muted">{t("limits.seatsBody")}</p>
      <div>
        <button type="button" onClick={onReview} className="btn-secondary rounded-lg px-3 py-1.5 text-xs font-semibold">
          {t("limits.reviewMembers")}
        </button>
      </div>
    </section>
  );
}
