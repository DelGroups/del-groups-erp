"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Factory, KanbanSquare, PackageCheck, Search, UserCheck } from "lucide-react";
import { CountUp } from "@/design-system/components";
import { AppGrid } from "@/components/shell/NewShell";
import { useShellApps } from "@/components/shell/useShell";
import type { AppKpi, AppKpiId, AppKpis } from "@/lib/shell/kpis";
import { WidgetFrame, WidgetState } from "../WidgetFrame";
import { useWidgetData } from "../useWidgetData";
import { useFigures } from "./format";
import { frameProps, type WidgetProps } from "./types";

// ── Apps (pinned) ───────────────────────────────────────────────────────

const KPI_APPS = new Set<AppKpiId>(["dashboard", "trade", "inventory", "production", "crm", "finance", "hr", "settings"]);

/** The app launcher as a widget: every app the user may open, with its live figure (/api/shell/kpis). */
export function AppsWidget(props: WidgetProps) {
  const { t, money, count } = useFigures();
  const { apps } = useShellApps();
  const [query, setQuery] = useState("");
  const [kpis, setKpis] = useState<AppKpis | null>(null);
  useEffect(() => {
    if (props.preview) return;
    let active = true;
    fetch("/api/shell/kpis", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<AppKpis>) : null))
      .then((data) => active && setKpis(data ?? {}))
      .catch(() => active && setKpis({}));
    return () => {
      active = false;
    };
  }, [props.preview]);
  const figure = (kpi: AppKpi | undefined) => (!kpi || kpi.value === null ? "—" : kpi.kind === "money" ? money(kpi.value) : count(kpi.value));
  return (
    <WidgetFrame
      {...frameProps(props)}
      action={
        <label className="flex w-full max-w-[14rem] items-center gap-2">
          <Search className="h-4 w-4 shrink-0 ds-muted" aria-hidden />
          <input className="ds-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("newShell.searchApps")} aria-label={t("newShell.searchApps")} />
        </label>
      }
    >
      <AppGrid
        apps={apps}
        query={query}
        renderExtra={(app) => {
          if (!KPI_APPS.has(app.id as AppKpiId)) return null;
          const kpi = kpis?.[app.id as AppKpiId];
          // No figure for this user (e.g. money without dashboard.view_financials): no line at all.
          if (kpis && !kpi) return null;
          return (
            <span className="mt-auto flex items-baseline justify-between gap-2 border-t pt-2 text-[length:var(--ds-text-xs)]" style={{ borderColor: "var(--ds-border)" }}>
              <span className="ds-muted">{t(kpi?.label ? `newShell.kpi_${kpi.label}` : `newShell.kpi_${app.id}`)}</span>
              <span className="ds-mono font-semibold" aria-live="polite">{kpis === null ? "…" : figure(kpi)}</span>
            </span>
          );
        }}
      />
    </WidgetFrame>
  );
}

// ── Low stock ───────────────────────────────────────────────────────────

interface LowStockData {
  count: number;
  items: { id: string; code: string | null; name: string; stock: number; min: number; unit: string | null; out: boolean }[];
  reorderHref: string | null;
}

export function LowStockWidget(props: WidgetProps) {
  const { t, locale, count } = useFigures();
  const q = useWidgetData<LowStockData>("low_stock", {}, !props.preview);
  const d = q.data?.data;
  return (
    <WidgetFrame {...frameProps(props)} action={<Link href="/inventory" className="ds-btn ds-btn-ghost ds-btn-sm">{t("home.lowStock.open")}</Link>}>
      <WidgetState status={props.preview ? "success" : q.status} onRetry={() => void q.refetch()} empty={!props.preview && !d?.count} emptyIcon={PackageCheck} emptyTitle={t("home.empty.lowStock")}>
        <p className="mb-2 flex items-baseline gap-2">
          <span className="text-[length:var(--ds-text-xl)] font-semibold"><CountUp value={d?.count ?? 0} locale={locale} /></span>
          <span className="ds-muted">{t("home.lowStock.below")}</span>
        </p>
        <ul className="flex flex-col">
          {(d?.items ?? []).slice(0, props.placement.size === "L" ? 8 : 5).map((p) => {
            const pct = Math.max(0, Math.min(100, (p.stock / Math.max(p.min, 1)) * 100));
            return (
              <li key={p.id} className="flex flex-col gap-1 py-1.5" style={{ borderTop: "1px solid var(--ds-border)" }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{p.name}</span>
                  <span className="shrink-0 text-[length:var(--ds-text-xs)] ds-mono" style={{ color: p.out ? "var(--ds-danger-strong)" : undefined }}>
                    {count(p.stock)} / {count(p.min)} {p.unit ?? ""}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "var(--ds-track, var(--ds-surface-sunken))" }} aria-hidden>
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: p.out ? "var(--ds-danger)" : "var(--ds-warning)" }} />
                </div>
              </li>
            );
          })}
        </ul>
        {d?.reorderHref ? (
          <Link href={d.reorderHref} className="ds-btn ds-btn-sm mt-3 self-start">{t("home.lowStock.reorder")}</Link>
        ) : null}
      </WidgetState>
    </WidgetFrame>
  );
}

// ── Production orders by status ────────────────────────────────────────

export function ProductionStatusWidget(props: WidgetProps) {
  const { t, locale } = useFigures();
  const q = useWidgetData<{ total: number; statuses: { status: string; count: number }[] }>("production_status", {}, !props.preview);
  const d = q.data?.data;
  const max = Math.max(1, ...(d?.statuses ?? []).map((s) => s.count));
  return (
    <WidgetFrame {...frameProps(props)} action={<Link href="/production" className="ds-btn ds-btn-ghost ds-btn-sm">{t("home.production.open")}</Link>}>
      <WidgetState status={props.preview ? "success" : q.status} onRetry={() => void q.refetch()} empty={!props.preview && !d?.total} emptyIcon={Factory} emptyTitle={t("home.empty.production")}>
        <p className="mb-2 flex items-baseline gap-2">
          <span className="text-[length:var(--ds-text-xl)] font-semibold"><CountUp value={d?.total ?? 0} locale={locale} /></span>
          <span className="ds-muted">{t("home.production.open_orders")}</span>
        </p>
        {props.placement.size !== "S" ? (
          <ul className="flex flex-col gap-1.5">
            {(d?.statuses ?? []).map((s) => (
              <li key={s.status} className="grid grid-cols-[7rem_1fr_auto] items-center gap-2 text-[length:var(--ds-text-xs)]">
                <span className="truncate">{t(`home.production.status.${s.status}`) === `home.production.status.${s.status}` ? s.status : t(`home.production.status.${s.status}`)}</span>
                <span className="h-2 rounded-full" style={{ width: `${(s.count / max) * 100}%`, background: "var(--ds-brand)" }} aria-hidden />
                <span className="ds-mono">{s.count}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </WidgetState>
    </WidgetFrame>
  );
}

// ── Away today ──────────────────────────────────────────────────────────

export function AwayTodayWidget(props: WidgetProps) {
  const { t, locale } = useFigures();
  const q = useWidgetData<{ count: number; items: { id: string; name: string; type: string; until: string }[] }>("away_today", {}, !props.preview);
  const d = q.data?.data;
  return (
    <WidgetFrame {...frameProps(props)}>
      <WidgetState status={props.preview ? "success" : q.status} onRetry={() => void q.refetch()} empty={!props.preview && !d?.count} emptyIcon={UserCheck} emptyTitle={t("home.empty.away")}>
        <ul className="flex flex-col">
          {(d?.items ?? []).map((l) => (
            <li key={l.id} className="flex items-center gap-2 py-1.5" style={{ borderTop: "1px solid var(--ds-border)" }}>
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[length:var(--ds-text-xs)] font-semibold" style={{ background: "var(--ds-brand-soft)", color: "var(--ds-brand)" }} aria-hidden>
                {l.name.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1 truncate">{l.name}</span>
              <span className="shrink-0 text-[length:var(--ds-text-xs)] ds-subtle">
                {t("home.away.until", { date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(`${l.until}T12:00:00`)) })}
              </span>
            </li>
          ))}
        </ul>
      </WidgetState>
    </WidgetFrame>
  );
}

// ── My CRM pipeline (counts only) ───────────────────────────────────────

export function MyPipelineWidget(props: WidgetProps) {
  const { t, locale } = useFigures();
  const q = useWidgetData<{ stages: { key: string; name: string | null; code?: string; color: string | null; won: boolean; count: number }[] }>("my_pipeline", {}, !props.preview);
  const stages = q.data?.data.stages ?? [];
  const total = stages.reduce((s, x) => s + x.count, 0);
  return (
    <WidgetFrame {...frameProps(props)} action={<Link href="/crm" className="ds-btn ds-btn-ghost ds-btn-sm">{t("home.pipeline.open")}</Link>}>
      <WidgetState status={props.preview ? "success" : q.status} onRetry={() => void q.refetch()} empty={!props.preview && total === 0} emptyIcon={KanbanSquare} emptyTitle={t("home.empty.pipeline")}>
        <div className="flex h-2 overflow-hidden rounded-full" aria-hidden>
          {stages.filter((s) => s.count).map((s) => (
            <span key={s.key} style={{ flex: s.count, background: s.color ?? "var(--ds-brand)" }} />
          ))}
        </div>
        <ul className="mt-2 flex flex-col gap-1 text-[length:var(--ds-text-sm)]">
          {stages.map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color ?? "var(--ds-brand)" }} aria-hidden />
              <span className="flex-1 truncate">{s.name ?? t(`crm.stages.${s.code}`)}</span>
              <span className="font-semibold"><CountUp value={s.count} locale={locale} /></span>
            </li>
          ))}
        </ul>
      </WidgetState>
    </WidgetFrame>
  );
}
