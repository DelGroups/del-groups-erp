"use client";

import { useI18n } from "@/i18n/I18nProvider";
import { formatGridDate, formatMoney } from "@/lib/dates/localeDate";
import type { ImportsConfig } from "@/lib/imports/config";
import type { CostType } from "@/lib/imports/landedCost";
import type { ShipmentEventView } from "../actions/posting";
import { costTypeLabel } from "./LandedCostPanel";

const TONE: Record<string, string> = {
  created: "neutral",
  confirmed: "brand",
  departed: "brand",
  arrived_customs: "brand",
  cleared: "brand",
  eta_changed: "warning",
  received_partial: "success",
  received: "success",
  cost_added: "neutral",
  cost_paid: "success",
  supplier_paid: "success",
  closed: "success",
  reopened: "warning",
  cancelled: "danger",
  note: "neutral",
};

/** "Tarixçə" (IMP-5): the shipment's events, newest first; each with its date, text and author. */
export function ImportTimeline({ events, config }: { events: readonly ShipmentEventView[]; config: ImportsConfig }) {
  const { t, locale } = useI18n();
  if (!events.length) return <p className="ds-muted">{t("imports.timeline.empty")}</p>;
  const detail = (e: ShipmentEventView): string | null => {
    const d = e.data ?? {};
    const amount = (key: string, cur: unknown) => (typeof d[key] === "number" ? formatMoney(d[key] as number, locale, { currency: typeof cur === "string" ? cur : "AZN" }) : null);
    switch (e.kind) {
      case "eta_changed":
        return t("imports.timeline.etaChange", { from: d.from ? formatGridDate(String(d.from)) : "—", to: d.to ? formatGridDate(String(d.to)) : "—" });
      case "cost_added":
        return [typeof d.cost_type === "string" ? costTypeLabel(d.cost_type as CostType, config, t) : null, amount("amount", d.currency)].filter(Boolean).join(" · ");
      case "cost_paid":
      case "supplier_paid":
        return [
          typeof d.cost_type === "string" ? costTypeLabel(d.cost_type as CostType, config, t) : null,
          typeof d.amount_fc === "number" && d.currency && d.currency !== "AZN" ? amount("amount_fc", d.currency) : null,
          amount("amount_azn", "AZN"),
          d.advance ? t("imports.timeline.inDraft") : null,
        ]
          .filter(Boolean)
          .join(" · ");
      default:
        return null;
    }
  };
  return (
    <ol className="ds-timeline" aria-label={t("imports.tabs.history")}>
      {[...events].reverse().map((e) => {
        const extra = detail(e);
        return (
          <li key={e.id}>
            <span className="ds-mono text-[length:var(--ds-text-xs)] ds-muted tabular-nums">{formatGridDate(e.eventDate)}</span>
            <span className="ds-timeline-dot" data-tone={TONE[e.kind] ?? "neutral"} aria-hidden />
            <div className="min-w-0">
              <div className="font-medium">{t(`imports.timelineKinds.${e.kind}`)}</div>
              {extra || e.note ? (
                <div className="text-[length:var(--ds-text-xs)] ds-muted">
                  {[extra, e.note].filter(Boolean).join(" — ")}
                </div>
              ) : null}
              {e.createdByName ? <div className="text-[length:var(--ds-text-xs)] ds-subtle">{e.createdByName}</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
