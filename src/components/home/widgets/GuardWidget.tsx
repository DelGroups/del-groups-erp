"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { CountUp } from "@/design-system/components";
import { guardDashboardAction } from "@/lib/actions/accountingGuardSection";
import { GUARD_SEVERITIES, guardFindingsHref, scoreTone, type GuardDashboard } from "@/lib/guard/findings";
import { WidgetFrame, WidgetState } from "../WidgetFrame";
import { useFigures } from "./format";
import { frameProps, type WidgetProps } from "./types";

const TONE_COLOR = { good: "var(--ds-success)", attention: "var(--ds-warning)", bad: "var(--ds-danger-strong)" } as const;

/** The Accounting Guard on the home page (GUARD-3): admins with ACCOUNTING_GUARD on. Health score and open findings. */
export function AccountingGuardWidget(props: WidgetProps) {
  const { t, locale } = useFigures();
  const q = useQuery({
    queryKey: ["guard", "dashboard", "widget"],
    enabled: !props.preview,
    refetchInterval: 120_000,
    refetchOnWindowFocus: true,
    staleTime: 60_000,
    queryFn: async (): Promise<GuardDashboard> => {
      const r = await guardDashboardAction();
      if (!r.success) throw new Error(r.error);
      return r.data;
    },
  });
  const d = q.data;
  const tone = scoreTone(d?.score ?? 100);
  return (
    <WidgetFrame {...frameProps(props)} action={<Link href="/finance/guard" className="ds-btn ds-btn-ghost ds-btn-sm">{t("guard.ui.widgetOpen")}</Link>}>
      <WidgetState status={props.preview ? "success" : q.status} onRetry={() => void q.refetch()} emptyIcon={ShieldCheck} emptyTitle={t("guard.ui.noOpenFindings")}>
        <p className="mb-2 flex items-baseline gap-2">
          <span className="text-[length:var(--ds-text-2xl)] font-semibold" style={{ color: TONE_COLOR[tone] }}>
            <CountUp value={d?.score ?? 100} locale={locale} />
          </span>
          <span className="ds-muted">{t("guard.ui.widgetScore")}</span>
        </p>
        <ul className="grid grid-cols-2 gap-2">
          {GUARD_SEVERITIES.map((s) => (
            <li key={s}>
              <Link href={guardFindingsHref({ severity: s, status: "open" })} className="flex items-baseline justify-between gap-2 rounded-[var(--ds-radius-sm)] px-2 py-1.5 hover:underline" style={{ background: "var(--ds-surface-sunken)" }}>
                <span className="text-[length:var(--ds-text-xs)]">{t(`guard.severity.${s}`)}</span>
                <span className="ds-mono tabular-nums">{d?.open[s] ?? 0}</span>
              </Link>
            </li>
          ))}
        </ul>
      </WidgetState>
    </WidgetFrame>
  );
}
