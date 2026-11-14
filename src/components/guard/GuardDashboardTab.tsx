"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, LoadingState, RingGauge, type GaugeTone } from "@/design-system/components";
import { StandardGrid, type StandardColumn } from "@/components/lists/StandardGrid";
import { useI18n } from "@/i18n/I18nProvider";
import { stateLabels } from "@/i18n/uiUnifiedLabels";
import { formatGridDate, formatGridDateTime, formatMoney } from "@/lib/dates/localeDate";
import { guardDashboardAction } from "@/lib/actions/accountingGuardSection";
import {
  GUARD_SEVERITIES,
  SCORE_WEIGHTS,
  guardFindingsHref,
  scoreTone,
  trendPoints,
  type GuardDashboard,
  type GuardFinding,
  type GuardSeverity,
} from "@/lib/guard/findings";
import { GUARD_KEYS, SeverityChip, ruleTitle } from "./guardUi";

const TONE: Record<ReturnType<typeof scoreTone>, GaugeTone> = { good: "good", attention: "attention", bad: "attention" };
const SEVERITY_COLOR: Record<GuardSeverity, string> = { critical: "var(--ds-danger-strong)", high: "var(--ds-warning)", medium: "var(--ds-info)", low: "var(--ds-text-muted)" };

/**
 * The Dashboard tab: the health score and how it is worked out, open findings by severity and by
 * category (each a link to the Findings tab with that filter), the trend over the last runs, the
 * last run, and the ten worst open findings.
 */
export default function GuardDashboardTab() {
  const { t, locale } = useI18n();
  const states = stateLabels(t);
  const query = useQuery({
    queryKey: GUARD_KEYS.dashboard,
    queryFn: async () => {
      const r = await guardDashboardAction();
      if (!r.success) throw new Error(r.error.startsWith("guard.") || r.error.startsWith("accountingGuard.") ? t(r.error) : r.error);
      return r.data;
    },
  });

  if (query.isError) return <ErrorState title={states.errorTitle} description={query.error instanceof Error ? query.error.message : undefined} retryLabel={states.retry} onRetry={() => void query.refetch()} />;
  if (!query.data) return <LoadingState label={states.loading} variant="cards" rows={4} />;
  return <Body data={query.data} locale={locale} />;
}

function Body({ data, locale }: { data: GuardDashboard; locale: string }) {
  const { t } = useI18n();
  const g = (key: string, p?: Record<string, string | number>) => t(`guard.ui.${key}`, p);
  const tone = scoreTone(data.score);
  const formula = GUARD_SEVERITIES.map((s) => `${t(`guard.severity.${s}`)} −${SCORE_WEIGHTS[s]}`).join(", ");

  const columns: StandardColumn<GuardFinding>[] = [
    { key: "severity", header: g("colSeverity"), width: 110, cell: (f) => <SeverityChip severity={f.severity} />, sortValue: (f) => GUARD_SEVERITIES.indexOf(f.severity) },
    { key: "rule", header: g("colRule"), width: 300, cell: (f) => ruleTitle(t, f.rule), sortValue: (f) => f.rule },
    { key: "doc", header: g("colDocument"), width: 140, cell: (f) => f.docNo ?? "—", sortValue: (f) => f.docNo },
    { key: "date", header: g("colDate"), type: "date", cell: (f) => (f.docDate ? formatGridDate(f.docDate) : "—"), sortValue: (f) => f.docDate },
    { key: "amount", header: g("colAmount"), type: "money", cell: (f) => (f.amount === null ? "—" : formatMoney(f.amount, locale, { currency: "AZN", decimals: 2 })), sortValue: (f) => f.amount },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)]">
        <RingGauge
          title={g("score")}
          percent={data.score}
          caption={g("scoreCaption", { score: data.score })}
          explanation={g("scoreFormula", { formula })}
          tone={TONE[tone]}
          footer={<span className="ds-muted text-[length:var(--ds-text-xs)]">{g(`scoreTone_${tone}`)}</span>}
        />
        <section aria-label={g("openBySeverity")} className="flex flex-col gap-3">
          <div className="ds-kpi-grid">
            {GUARD_SEVERITIES.map((s) => (
              <Link key={s} href={guardFindingsHref({ severity: s, status: "open" })} className="ds-card flex min-w-0 flex-col gap-1 p-4 hover:underline" aria-label={g("showSeverity", { severity: t(`guard.severity.${s}`), count: data.open[s] })}>
                <span className="ds-muted truncate text-[length:var(--ds-text-xs)]">{t(`guard.severity.${s}`)}</span>
                <span className="ds-num text-[length:var(--ds-text-xl)] font-semibold tabular-nums" style={data.open[s] > 0 ? { color: SEVERITY_COLOR[s] } : undefined}>
                  {data.open[s]}
                </span>
              </Link>
            ))}
          </div>
          <p className="ds-muted text-[length:var(--ds-text-sm)]">
            {g("openSummary", { open: data.open.total, acknowledged: data.acknowledged })}
            {data.lastRun ? ` · ${g("lastRun", { when: formatGridDateTime(data.lastRun.startedAt) })}` : ` · ${g("neverRun")}`}
          </p>
          <Trend trend={data.trend} />
        </section>
      </div>

      <section className="ds-card flex flex-col gap-2 p-4" aria-label={g("byCategory")}>
        <h2 className="text-[length:var(--ds-text-sm)] font-semibold">{g("byCategory")}</h2>
        {data.byCategory.length === 0 ? (
          <p className="ds-muted text-[length:var(--ds-text-sm)]">{g("noOpenFindings")}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {data.byCategory.map(({ category, counts }) => (
              <li key={category}>
                <Link href={guardFindingsHref({ category, status: "open" })} className="flex items-center justify-between gap-3 rounded-[var(--ds-radius-md)] border border-[var(--ds-border)] px-3 py-2 text-[length:var(--ds-text-sm)] hover:bg-[var(--ds-surface-sunken)]">
                  <span>{t(`guard.category.${category}`)}</span>
                  <span className="ds-num tabular-nums">
                    {GUARD_SEVERITIES.filter((s) => counts[s] > 0)
                      .map((s) => `${t(`guard.severity.${s}`)} ${counts[s]}`)
                      .join(" · ") || "0"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-label={g("topFindings")}>
        <h2 className="text-[length:var(--ds-text-sm)] font-semibold">{g("topFindings")}</h2>
        <StandardGrid<GuardFinding>
          id="guard-dashboard-top"
          label={g("topFindings")}
          rows={data.top}
          rowKey={(f) => f.id}
          columns={columns}
          empty={g("noCriticalHigh")}
          rowHref={(f) => guardFindingsHref({ finding: f.id })}
        />
      </section>
    </div>
  );
}

/** Open findings after each of the last runs: a small line, with its numbers in the text for screen readers. */
function Trend({ trend }: { trend: GuardDashboard["trend"] }) {
  const { t } = useI18n();
  const points = trendPoints(trend);
  if (points.length === 0) return null;
  const w = 240;
  const h = 48;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${(p.x * w).toFixed(1)} ${(4 + p.y * (h - 8)).toFixed(1)}`).join(" ");
  const first = trend[0].openCount;
  const last = trend[trend.length - 1].openCount;
  return (
    <figure className="flex items-center gap-3">
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={t("guard.ui.trendLabel", { count: trend.length, from: first, to: last })} className="max-w-full">
        <path d={path} fill="none" stroke="var(--ds-brand)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <figcaption className="ds-muted text-[length:var(--ds-text-xs)]">{t("guard.ui.trendLabel", { count: trend.length, from: first, to: last })}</figcaption>
    </figure>
  );
}
