"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { EmptyState, FunnelSteps, GoalProgress, SkeletonList } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { useFormatter, ViewScope } from "@/views";
import { addMonths, forecastByMonth, funnel, lostReasonLabel, lostReasons, stageKind, stagesForTeam, targetProgress, teamLabel, weightedValue, winRateByUser, type PipelineDeal } from "../../lib/pipeline";
import { fetchReportDeals } from "../../lib/pipelineData";
import { usePipeline } from "../../hooks/usePipeline";
import { dateFormat } from "@/lib/dates/localeDate";

/** CRM reports (prompt 21, NEW_CRM): funnel, forecast by month, win rate by salesperson, lost reasons, targets. */
export function CrmReportsScreen() {
  return (
    <ViewScope>
      <Reports />
    </ViewScope>
  );
}

function dealFromRow(r: Record<string, unknown>): PipelineDeal {
  return {
    id: String(r.id),
    title: String(r.title ?? ""),
    type: r.type === "lead" ? "lead" : "opportunity",
    team_id: (r.team_id as string) || null,
    stage_id: (r.stage_id as string) || null,
    expected_value: Number(r.expected_value) || 0,
    probability: Number(r.probability) || 0,
    expected_close: (r.expected_close as string) || null,
    assigned_to: (r.assigned_to as string) || null,
    lost_reason_id: (r.lost_reason_id as string) || null,
    won_at: (r.won_at as string) || null,
    lost_at: (r.lost_at as string) || null,
    created_at: (r.created_at as string) || null,
  };
}

function Reports() {
  const { t } = useI18n();
  const fmt = useFormatter();
  const pipeline = usePipeline();
  const rows = useQuery({ queryKey: ["crm", "report-deals"], queryFn: fetchReportDeals });
  const [teamId, setTeamId] = useState<string>("");
  const now = useMemo(() => new Date(), []);
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const { teams, stages, lostReasons: reasons, targets } = pipeline.settings;

  const deals = useMemo(() => (rows.data ?? []).map(dealFromRow).filter((d) => !teamId || d.team_id === teamId), [rows.data, teamId]);
  const teamStages = useMemo(() => (teamId ? stagesForTeam(stages, teamId) : [...stages].sort((a, b) => a.sequence - b.sequence)), [stages, teamId]);

  if (!pipeline.ready || rows.isPending) return <SkeletonList loading rows={6} label={t("common.loading")}>{null}</SkeletonList>;
  if (rows.isError) return <EmptyState icon={AlertTriangle} title={t("views.error")} action={<button type="button" className="ds-btn ds-btn-sm" onClick={() => void rows.refetch()}>{t("views.retry")}</button>} />;

  const money = (n: number) => `${new Intl.NumberFormat(fmt.locale, { maximumFractionDigits: 0 }).format(n)} ${t("common.currency")}`;
  const count = (n: number) => new Intl.NumberFormat(fmt.locale).format(n);
  const kind = new Map(stages.map((s) => [s.id, stageKind(s)] as const));
  const open = deals.filter((d) => d.type === "opportunity" && (d.stage_id ? kind.get(d.stage_id) : "open") === "open");
  const openValue = open.reduce((s, d) => s + d.expected_value, 0);
  const openWeighted = open.reduce((s, d) => s + weightedValue(d), 0);
  const wonThisMonth = deals.filter((d) => d.won_at?.startsWith(month)).reduce((s, d) => s + d.expected_value, 0);
  const steps = funnel(deals.filter((d) => d.type === "opportunity"), teamStages);
  const forecast = forecastByMonth(deals, stages, now, 6);
  const maxForecast = Math.max(1, ...forecast.map((f) => Math.max(f.expected, f.won)));
  const rates = winRateByUser(deals, stages);
  const people = new Map(pipeline.salespeople.map((p) => [p.id, p.full_name] as const));
  const lost = lostReasons(deals, stages);
  const lostMax = Math.max(1, ...lost.map((l) => l.count));
  const progress = targetProgress(teamId ? targets.filter((x) => x.team_id === teamId) : targets, deals, stages, month);
  const elapsed = now.getDate() / new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthLabel = (m: string) => dateFormat(fmt.locale, { month: "short", year: "numeric" }).format(new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1));

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[length:var(--ds-text-xl)] font-semibold">{t("crm.pipeline.reports.title")}</h1>
          <p className="ds-muted">{t("crm.pipeline.reports.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {teams.length > 1 ? (
            <select className="ds-input" value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label={t("crm.pipeline.fields.team")}>
              <option value="">{t("crm.pipeline.reports.allTeams")}</option>
              {teams.map((tm) => (
                <option key={tm.id} value={tm.id}>{teamLabel(tm, t)}</option>
              ))}
            </select>
          ) : null}
          <Link href="/crm" className="ds-btn ds-btn-sm">{t("crm.pipeline.backToPipeline")}</Link>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={t("crm.pipeline.reports.kpis")}>
        {[
          { label: t("crm.pipeline.reports.openValue"), value: money(openValue), hint: t("crm.pipeline.reports.openCount", { count: open.length }) },
          { label: t("crm.pipeline.reports.weighted"), value: money(openWeighted), hint: t("crm.pipeline.reports.weightedHint") },
          { label: t("crm.pipeline.reports.wonThisMonth"), value: money(wonThisMonth), hint: monthLabel(month) },
          {
            label: t("crm.pipeline.reports.winRate"),
            value: (() => {
              const won = rates.reduce((s, r) => s + r.won, 0);
              const closed = won + rates.reduce((s, r) => s + r.lost, 0);
              return closed ? `${Math.round((won / closed) * 100)}%` : "—";
            })(),
            hint: t("crm.pipeline.reports.winRateHint"),
          },
        ].map((k) => (
          <div key={k.label} className="ds-card ds-card-pad flex flex-col gap-1">
            <span className="ds-muted">{k.label}</span>
            <span className="text-[length:var(--ds-text-2xl)] font-semibold tracking-tight ds-mono">{k.value}</span>
            <span className="text-[length:var(--ds-text-xs)] ds-subtle">{k.hint}</span>
          </div>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <FunnelSteps
          title={t("crm.pipeline.reports.funnel")}
          subtitle={t("crm.pipeline.reports.funnelHint")}
          steps={steps.map((s) => ({ label: s.stage.name, count: s.count }))}
          formatCount={count}
          labels={{
            dropped: (c, p) => t("crm.pipeline.reports.dropped", { count: c, percent: p }),
            entered: t("crm.pipeline.reports.entered"),
            completed: t("crm.pipeline.reports.completed"),
            conversion: t("crm.pipeline.reports.conversion"),
          }}
        />

        <section className="ds-card ds-card-pad flex flex-col gap-3" aria-labelledby="crm-forecast">
          <div>
            <h3 id="crm-forecast" className="font-semibold">{t("crm.pipeline.reports.forecast")}</h3>
            <p className="text-[length:var(--ds-text-xs)] ds-muted">{t("crm.pipeline.reports.forecastHint")}</p>
          </div>
          <table className="w-full border-collapse text-left text-[length:var(--ds-text-sm)]">
            <thead>
              <tr>
                <th scope="col" className="py-1 ds-label">{t("crm.pipeline.reports.month")}</th>
                <th scope="col" className="py-1 ds-label">{t("crm.pipeline.reports.expected")}</th>
                <th scope="col" className="py-1 text-right ds-label">{t("crm.pipeline.reports.weighted")}</th>
                <th scope="col" className="py-1 text-right ds-label">{t("crm.pipeline.reports.won")}</th>
              </tr>
            </thead>
            <tbody>
              {forecast.map((f) => (
                <tr key={f.month} style={{ borderTop: "1px solid var(--ds-border)" }}>
                  <th scope="row" className="py-1.5 font-medium">{monthLabel(f.month)}</th>
                  <td className="py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="h-2 rounded-full" style={{ width: `${Math.max(2, (f.expected / maxForecast) * 100)}%`, maxWidth: "8rem", background: "var(--ds-accent)" }} aria-hidden />
                      <span className="ds-mono">{money(f.expected)}</span>
                      <span className="ds-subtle text-[length:var(--ds-text-xs)]">{t("crm.pipeline.reports.deals", { count: f.count })}</span>
                    </div>
                  </td>
                  <td className="py-1.5 text-right ds-mono">{money(f.weighted)}</td>
                  <td className="py-1.5 text-right ds-mono">{f.month <= month ? money(f.won) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[length:var(--ds-text-xs)] ds-subtle">{t("crm.pipeline.reports.forecastRange", { from: monthLabel(month), to: monthLabel(addMonths(month, 5)) })}</p>
        </section>

        <section className="ds-card ds-card-pad flex flex-col gap-3" aria-labelledby="crm-winrate">
          <h3 id="crm-winrate" className="font-semibold">{t("crm.pipeline.reports.winRateByUser")}</h3>
          {rates.length === 0 ? (
            <p className="ds-muted">{t("crm.pipeline.reports.noData")}</p>
          ) : (
            <table className="w-full border-collapse text-left text-[length:var(--ds-text-sm)]">
              <thead>
                <tr>
                  <th scope="col" className="py-1 ds-label">{t("crm.pipeline.fields.salesperson")}</th>
                  <th scope="col" className="py-1 text-right ds-label">{t("crm.pipeline.reports.won")}</th>
                  <th scope="col" className="py-1 text-right ds-label">{t("crm.pipeline.reports.lost")}</th>
                  <th scope="col" className="py-1 text-right ds-label">{t("crm.pipeline.reports.open")}</th>
                  <th scope="col" className="py-1 text-right ds-label">{t("crm.pipeline.reports.winRate")}</th>
                  <th scope="col" className="py-1 text-right ds-label">{t("crm.pipeline.reports.wonValue")}</th>
                </tr>
              </thead>
              <tbody>
                {rates.map((r) => (
                  <tr key={r.userId ?? "none"} style={{ borderTop: "1px solid var(--ds-border)" }}>
                    <th scope="row" className="py-1.5 font-medium">{r.userId ? people.get(r.userId) ?? "—" : t("crm.pipeline.reports.unassigned")}</th>
                    <td className="py-1.5 text-right ds-mono">{r.won}</td>
                    <td className="py-1.5 text-right ds-mono">{r.lost}</td>
                    <td className="py-1.5 text-right ds-mono">{r.open}</td>
                    <td className="py-1.5 text-right ds-mono">{r.rate === null ? "—" : `${r.rate}%`}</td>
                    <td className="py-1.5 text-right ds-mono">{money(r.wonValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="ds-card ds-card-pad flex flex-col gap-3" aria-labelledby="crm-lost">
          <h3 id="crm-lost" className="font-semibold">{t("crm.pipeline.reports.lostReasons")}</h3>
          {lost.length === 0 ? (
            <p className="ds-muted">{t("crm.pipeline.reports.noLost")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {lost.map((l) => (
                <li key={l.reasonId ?? "none"} className="flex flex-col gap-1">
                  <div className="flex justify-between gap-2">
                    <span>{lostReasonLabel(reasons.find((r) => r.id === l.reasonId), t)}</span>
                    <span className="ds-mono">{t("crm.pipeline.reports.lostCount", { count: l.count, value: money(l.value) })}</span>
                  </div>
                  <span className="h-2 rounded-full" style={{ width: `${(l.count / lostMax) * 100}%`, background: "var(--ds-danger)" }} aria-hidden />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {progress.length ? (
        <GoalProgress
          title={t("crm.pipeline.reports.targets", { month: monthLabel(month) })}
          note={t("crm.pipeline.reports.targetsHint")}
          goals={progress.map((p) => {
            const team = teams.find((x) => x.id === p.target.team_id);
            return { label: p.target.user_id ? `${people.get(p.target.user_id) ?? "—"} · ${teamLabel(team, t)}` : teamLabel(team, t), current: p.won, target: p.target.amount };
          })}
          periodElapsed={elapsed}
          formatValue={money}
          statusLabels={{ done: t("crm.pipeline.reports.targetDone"), onTrack: t("crm.pipeline.reports.targetOnTrack"), behind: t("crm.pipeline.reports.targetBehind") }}
        />
      ) : (
        <p className="ds-muted">{t("crm.pipeline.reports.noTargets")}</p>
      )}
    </div>
  );
}
