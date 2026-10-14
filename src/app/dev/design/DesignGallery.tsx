"use client";

import React, { useMemo, useState } from "react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import {
  BarChart3,
  Boxes,
  FilePlus2,
  FolderOpen,
  LayoutDashboard,
  MoonStar,
  Plus,
  ShoppingCart,
  Shuffle,
  UserPlus,
  X,
} from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import {
  ChartCard,
  CohortHeatmap,
  CommandPalette,
  DesignScope,
  EmptyState,
  FileDropzone,
  FunnelSteps,
  GoalProgress,
  MetricCard,
  MetricsBand,
  RingGauge,
  SkeletonList,
  ToastProvider,
  TypeToConfirmDialog,
  useToast,
  type PaletteAction,
  type UploadFn,
} from "@/design-system/components";
import { DEFAULT_BRAND, normalizeHex } from "@/design-system/brand";
import type { DsDensity } from "@/design-system/theme";
import { formatFigure, percentChange, type PaletteGroup, type StackedColumn } from "@/design-system/logic";
import { listItemVariants, listVariants, motionPreset, pageVariants, recordLayoutId, transitions } from "@/design-system/motion";

type Range = "7d" | "30d" | "90d";
type T = (key: string, params?: Record<string, string | number>) => string;

/** Fake upload for the gallery: progress over ~1 s, files named "fail…" fail. */
const demoUpload: UploadFn = (file, onProgress) =>
  new Promise((resolve, reject) => {
    let p = 0;
    const timer = setInterval(() => {
      p += 0.2;
      onProgress(p);
      if (p >= 1) {
        clearInterval(timer);
        if (file.name.toLowerCase().startsWith("fail")) reject(new Error("demo failure"));
        else resolve();
      }
    }, 200);
  });

const SERIES: Record<Range, StackedColumn[]> = {
  "7d": ["1", "2", "3", "4", "5", "6", "7"].map((d, i) => ({ label: d, values: [12 + ((i * 7) % 9), 6 + ((i * 5) % 7)] })),
  "30d": Array.from({ length: 10 }, (_, i) => ({ label: String(i * 3 + 1), values: [40 + ((i * 13) % 25), 22 + ((i * 7) % 15)] })),
  "90d": Array.from({ length: 12 }, (_, i) => ({ label: String(i + 1), values: [120 + ((i * 37) % 70), 70 + ((i * 17) % 40)] })),
};
const PREVIOUS_TOTAL: Record<Range, number> = { "7d": 150, "30d": 600, "90d": 2300 };

export default function DesignGallery({ brand: initialBrand, fontClassName }: { brand: string | null; fontClassName: string }) {
  const { t } = useI18n();
  const [density, setDensity] = useState<DsDensity>("comfortable");
  const [brand, setBrand] = useState(initialBrand ?? DEFAULT_BRAND);

  return (
    <main className="min-h-screen bg-app p-4 md:p-6">
      <DesignScope theme="light" density={density} brand={brand} className={`${fontClassName} mb-4 rounded-2xl p-5`}>
        <h1 className="text-[length:var(--ds-text-2xl)] font-semibold">{t("designSystem.title")}</h1>
        <p className="mt-1 max-w-3xl ds-muted">{t("designSystem.intro")}</p>
        <div className="mt-4 flex flex-wrap items-end gap-6">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="ds-label mb-1.5">{t("designSystem.density")}</legend>
            <div className="flex gap-2">
              {(["comfortable", "compact"] as const).map((d) => (
                <label key={d} className="ds-btn ds-btn-sm cursor-pointer" style={density === d ? { borderColor: "var(--ds-brand)", background: "var(--ds-brand-soft)" } : undefined}>
                  <input type="radio" name="ds-density" className="sr-only" checked={density === d} onChange={() => setDensity(d)} />
                  {t(`designSystem.${d}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex flex-col gap-1.5">
            <span className="ds-label">{t("designSystem.brand")}</span>
            <span className="flex items-center gap-2">
              <input type="color" value={brand} onChange={(e) => setBrand(normalizeHex(e.target.value) ?? DEFAULT_BRAND)} className="h-9 w-12 cursor-pointer rounded" aria-label={t("designSystem.brand")} />
              <code className="ds-mono">{brand}</code>
            </span>
          </label>
          <p className="max-w-md text-[length:var(--ds-text-xs)] ds-muted">{t("designSystem.brandHint")}</p>
        </div>
        <p className="mt-3 text-[length:var(--ds-text-xs)] ds-subtle">{t("designSystem.reducedMotionNote")}</p>
      </DesignScope>

      <div className="grid gap-4 xl:grid-cols-2">
        {(["light", "dark"] as const).map((theme) => (
          <DesignScope key={theme} theme={theme} density={density} brand={brand} className={`${fontClassName} rounded-2xl`}>
            <ToastProvider closeLabel={t("designSystem.close")}>
              <section aria-label={t(`designSystem.${theme}`)} className="flex flex-col gap-6 p-5">
                <h2 className="ds-label">{t(`designSystem.${theme}`)}</h2>
                <Gallery t={t} />
              </section>
            </ToastProvider>
          </DesignScope>
        ))}
      </div>
    </main>
  );
}

function Section({ title, reference, children }: { title: string; reference: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[length:var(--ds-text-lg)] font-semibold">{title}</h3>
        <code className="text-[length:var(--ds-text-xs)] ds-subtle">{reference}</code>
      </div>
      {children}
    </section>
  );
}

function Gallery({ t }: { t: T }) {
  const { locale } = useI18n();
  const { toast } = useToast();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>("30d");
  const num = (n: number, d = 0) => formatFigure(n, d, locale);

  const groups = useMemo<PaletteGroup<PaletteAction>[]>(() => {
    const ran = (label: string) => () => toast(t("designSystem.paletteRan", { command: label }), undefined, "info");
    const cmd = (id: string, icon: PaletteAction["icon"], shortcut?: string[], keywords?: string[]): PaletteAction => {
      const label = t(`designSystem.${id}`);
      return { id, label, icon, shortcut, keywords, onSelect: ran(label) };
    };
    return [
      {
        id: "go",
        heading: t("designSystem.groupGoTo"),
        commands: [
          cmd("cmdDashboard", LayoutDashboard, ["G", "D"], ["dashboard", "panel"]),
          cmd("cmdSales", ShoppingCart, ["G", "S"], ["sales", "satış", "продажи"]),
          cmd("cmdInventory", Boxes, ["G", "I"], ["inventory", "anbar", "склад"]),
        ],
      },
      {
        id: "actions",
        heading: t("designSystem.groupActions"),
        commands: [
          cmd("cmdNewInvoice", FilePlus2, ["N", "I"], ["invoice", "faktura", "счёт"]),
          cmd("cmdNewCustomer", UserPlus, ["N", "C"], ["customer", "müştəri", "клиент"]),
          cmd("cmdToggleTheme", MoonStar),
        ],
      },
    ];
  }, [t, toast]);

  const chartTotal = SERIES[range].reduce((s, c) => s + c.values[0] + c.values[1], 0);

  return (
    <>
      <Section title={t("designSystem.secPalette")} reference="bonus/bonus-command-palette">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="ds-btn ds-btn-primary" onClick={() => setPaletteOpen(true)}>
            {t("designSystem.paletteOpen")}
          </button>
          <span className="ds-muted">
            <kbd className="ds-kbd">Ctrl</kbd> + <kbd className="ds-kbd">K</kbd>
          </span>
        </div>
        <CommandPalette
          groups={groups}
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          hotkey={false}
          labels={{
            title: t("designSystem.paletteTitle"),
            placeholder: t("designSystem.palettePlaceholder"),
            empty: t("designSystem.paletteEmpty"),
            navigate: t("designSystem.paletteNavigate"),
            select: t("designSystem.paletteSelect"),
            close: t("designSystem.paletteClose"),
          }}
        />
      </Section>

      <Section title={t("designSystem.secToast")} reference="bonus/bonus-toast-notification">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="ds-btn" onClick={() => toast(t("designSystem.toastSavedTitle"), t("designSystem.toastSavedBody"), "success")}>
            {t("designSystem.toastSuccess")}
          </button>
          <button type="button" className="ds-btn" onClick={() => toast(t("designSystem.toastFailedTitle"), t("designSystem.toastFailedBody"), "error")}>
            {t("designSystem.toastError")}
          </button>
          <button type="button" className="ds-btn" onClick={() => toast(t("designSystem.toastInfoTitle"), t("designSystem.toastInfoBody"), "info")}>
            {t("designSystem.toastInfo")}
          </button>
        </div>
      </Section>

      <Section title={t("designSystem.secEmpty")} reference="bonus/bonus-empty-state">
        <EmptyState
          icon={FolderOpen}
          title={t("designSystem.emptyTitle")}
          description={t("designSystem.emptyBody")}
          action={
            <button type="button" className="ds-btn ds-btn-primary">
              <Plus className="h-4 w-4" aria-hidden /> {t("designSystem.emptyAction")}
            </button>
          }
          secondary={
            <a href="#" className="underline ds-muted" onClick={(e) => e.preventDefault()}>
              {t("designSystem.emptySecondary")}
            </a>
          }
        />
      </Section>

      <Section title={t("designSystem.secSkeleton")} reference="bonus/bonus-skeleton-loading-state">
        <div className="ds-card overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b px-5 py-3" style={{ borderColor: "var(--ds-border)" }}>
            <div>
              <h4 className="font-semibold">{t("designSystem.skeletonTitle")}</h4>
              <p className="text-[length:var(--ds-text-xs)] ds-muted" aria-live="polite">
                {loading ? t("designSystem.skeletonLoading") : t("designSystem.skeletonLoaded", { count: 4 })}
              </p>
            </div>
            <div className="flex gap-2">
              <button type="button" className="ds-btn ds-btn-sm" onClick={() => setLoading((v) => !v)}>
                {loading ? t("designSystem.skeletonShow") : t("designSystem.skeletonRefresh")}
              </button>
            </div>
          </div>
          <SkeletonList loading={loading} label={t("designSystem.skeletonLoading")}>
            <ul>
              {[1, 2, 3, 4].map((n) => (
                <li key={n} className="flex items-center gap-3 border-b last:border-0" style={{ padding: "var(--ds-pad-y) var(--ds-pad-x)", borderColor: "var(--ds-border)" }}>
                  <span className="grid h-9 w-9 place-items-center rounded-full text-[length:var(--ds-text-xs)] font-semibold" style={{ background: "var(--ds-brand-soft)", color: "var(--ds-brand)" }} aria-hidden>
                    {t(`designSystem.sampleRow${n}`).slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{t(`designSystem.sampleRow${n}`)}</p>
                    <p className="text-[length:var(--ds-text-xs)] ds-muted ds-mono">INV-2026-{String(n * 37).padStart(5, "0")}</p>
                  </div>
                  <span className={`ds-chip ${n === 3 ? "ds-chip-down" : n === 2 ? "ds-chip-flat" : "ds-chip-up"}`}>
                    {t(n === 3 ? "designSystem.statusOverdue" : n === 2 ? "designSystem.statusDraft" : "designSystem.statusPaid")}
                  </span>
                </li>
              ))}
            </ul>
          </SkeletonList>
        </div>
      </Section>

      <Section title={t("designSystem.secDropzone")} reference="bonus/bonus-file-upload-dropzone">
        <FileDropzone
          rules={{ maxBytes: 10 * 1024 * 1024, accept: [".pdf", ".png", ".jpg", ".jpeg", ".xlsx"] }}
          upload={demoUpload}
          labels={{
            drag: t("designSystem.dropDrag"),
            browse: t("designSystem.dropBrowse"),
            constraints: t("designSystem.dropConstraints"),
            tooLarge: t("designSystem.dropTooLarge"),
            wrongType: t("designSystem.dropWrongType"),
            empty: t("designSystem.dropEmpty"),
            failed: t("designSystem.dropFailed"),
            retry: t("designSystem.dropRetry"),
            remove: t("designSystem.dropRemove"),
            done: t("designSystem.dropDone"),
          }}
        />
      </Section>

      <Section title={t("designSystem.secConfirm")} reference="bonus/bonus-type-to-confirm-delete-dialog">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="ds-btn ds-btn-danger" onClick={() => setConfirmOpen(true)}>
            {t("designSystem.confirmOpen")}
          </button>
          {deleted ? <span className="ds-muted">{t("designSystem.confirmDone")}</span> : null}
        </div>
        <TypeToConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          confirmText="acme-warehouse"
          consequences={[t("designSystem.confirmItem1"), t("designSystem.confirmItem2"), t("designSystem.confirmItem3")]}
          onConfirm={() =>
            new Promise<void>((resolve) =>
              setTimeout(() => {
                setDeleted(true);
                resolve();
              }, 700)
            )
          }
          labels={{
            title: t("designSystem.confirmTitle", { name: "acme-warehouse" }),
            description: t("designSystem.confirmBody"),
            instruction: t("designSystem.confirmInstruction"),
            copy: t("designSystem.confirmCopy"),
            cancel: t("designSystem.confirmCancel"),
            confirm: t("designSystem.confirmDelete"),
            working: t("designSystem.confirmWorking"),
            audit: t("designSystem.confirmAudit"),
          }}
        />
      </Section>

      <Section title={t("designSystem.secMetrics")} reference="stats/stats-metric-cards-with-sparkline-bars">
        <div className="grid gap-3 md:grid-cols-3">
          <MetricCard label={t("designSystem.metricRevenue")} value={`${num(48210)} AZN`} delta={12.4} deltaLabel={t("designSystem.metricDelta")} series={[22, 28, 25, 31, 35, 30, 38, 44]} seriesLabel={t("designSystem.metricSeries")} />
          <MetricCard label={t("designSystem.metricOrders")} value={num(1284)} delta={-3.1} deltaLabel={t("designSystem.metricDelta")} series={[60, 58, 64, 55, 52, 57, 50, 49]} seriesLabel={t("designSystem.metricSeries")} />
          <MetricCard label={t("designSystem.metricCustomers")} value={num(312)} delta={0} deltaLabel={t("designSystem.metricDelta")} series={[30, 31, 30, 32, 31, 30, 31, 31]} seriesLabel={t("designSystem.metricSeries")} />
        </div>
      </Section>

      <Section title={t("designSystem.secGauges")} reference="stats/stats-ring-gauge-trio">
        <div className="grid gap-3 md:grid-cols-3">
          <RingGauge title={t("designSystem.gaugeOnTime")} percent={94} tone="good" caption={t("designSystem.gaugeCaption")} explanation={t("designSystem.gaugeOnTimeBody")} footer={t("designSystem.gaugeFooter", { done: num(470), total: num(500) })} />
          <RingGauge title={t("designSystem.gaugeStock")} percent={61} tone="attention" caption={t("designSystem.gaugeCaption")} explanation={t("designSystem.gaugeStockBody")} footer={t("designSystem.gaugeFooter", { done: num(183), total: num(300) })} />
          <RingGauge title={t("designSystem.gaugeCollected")} percent={78} tone="neutral" caption={t("designSystem.gaugeCaption")} explanation={t("designSystem.gaugeCollectedBody")} footer={t("designSystem.gaugeFooter", { done: num(39), total: num(50) })} />
        </div>
      </Section>

      <Section title={t("designSystem.secFunnel")} reference="stats/stats-conversion-funnel-steps">
        <FunnelSteps
          title={t("designSystem.funnelTitle")}
          subtitle={t("designSystem.funnelRange")}
          steps={[
            { label: t("designSystem.funnelLeads"), count: 4200 },
            { label: t("designSystem.funnelQualified"), count: 2310 },
            { label: t("designSystem.funnelQuotes"), count: 980 },
            { label: t("designSystem.funnelOrders"), count: 412 },
            { label: t("designSystem.funnelPaid"), count: 371 },
          ]}
          formatCount={(n) => num(n)}
          labels={{
            dropped: (count, percent) => t("designSystem.funnelDropped", { count, percent }),
            entered: t("designSystem.funnelEntered"),
            completed: t("designSystem.funnelCompleted"),
            conversion: t("designSystem.funnelConversion"),
          }}
        />
      </Section>

      <Section title={t("designSystem.secGoals")} reference="stats/stats-goal-progress-bars">
        <GoalProgress
          title={t("designSystem.goalsTitle")}
          note={t("designSystem.goalsNote")}
          periodElapsed={0.5}
          formatValue={(n) => num(n)}
          statusLabels={{ done: t("designSystem.goalDone"), onTrack: t("designSystem.goalOnTrack"), behind: t("designSystem.goalBehind") }}
          goals={[
            { label: t("designSystem.goalRevenue"), current: 182000, target: 300000 },
            { label: t("designSystem.goalNewCustomers"), current: 48, target: 80 },
            { label: t("designSystem.goalCollection"), current: 31, target: 90 },
            { label: t("designSystem.goalStock"), current: 120, target: 100 },
          ]}
        />
      </Section>

      <Section title={t("designSystem.secCohort")} reference="stats/stats-cohort-retention-heatmap">
        <CohortHeatmap
          title={t("designSystem.cohortTitle")}
          subtitle={t("designSystem.cohortSubtitle")}
          weeks={7}
          footnote={t("designSystem.cohortFootnote")}
          labels={{
            cohort: t("designSystem.cohortCol"),
            users: t("designSystem.cohortUsers"),
            week: (n) => t("designSystem.cohortWeek", { n }),
            low: t("designSystem.cohortLow"),
            high: t("designSystem.cohortHigh"),
            cellTitle: (percent, users) => t("designSystem.cohortCellTitle", { percent: Math.round(percent), users }),
          }}
          cohorts={[
            { label: monthLabel(6), users: 120, retention: [100, 72, 61, 55, 51, 49, 47] },
            { label: monthLabel(7), users: 154, retention: [100, 76, 64, 58, 53, 50] },
            { label: monthLabel(8), users: 98, retention: [100, 69, 57, 49, 45] },
            { label: monthLabel(9), users: 171, retention: [100, 81, 70, 63] },
            { label: monthLabel(10), users: 143, retention: [100, 74] },
          ]}
        />
      </Section>

      <Section title={t("designSystem.secCountUp")} reference="stats/stats-count-up-metrics-on-view">
        <MetricsBand
          locale={locale}
          eyebrow={t("designSystem.bandEyebrow")}
          heading={t("designSystem.bandHeading")}
          metrics={[
            { value: 99.98, suffix: "%", label: t("designSystem.bandUptime"), note: t("designSystem.bandUptimeNote") },
            { value: 24180, label: t("designSystem.bandDocs"), note: t("designSystem.bandDocsNote") },
            { value: 41, suffix: "ms", label: t("designSystem.bandResponse"), note: t("designSystem.bandResponseNote") },
            { value: 14, label: t("designSystem.bandBranches"), note: t("designSystem.bandBranchesNote") },
          ]}
        />
      </Section>

      <Section title={t("designSystem.secChart")} reference="dashboards/dashboards-chart-card-with-legend">
        <ChartCard
          title={t("designSystem.chartTitle")}
          total={num(chartTotal)}
          delta={percentChange(chartTotal, PREVIOUS_TOTAL[range])}
          ranges={[
            { id: "7d", label: t("designSystem.range7") },
            { id: "30d", label: t("designSystem.range30") },
            { id: "90d", label: t("designSystem.range90") },
          ]}
          range={range}
          onRangeChange={setRange}
          columns={SERIES[range]}
          series={[t("designSystem.seriesNew"), t("designSystem.seriesReturning")]}
          formatValue={(n) => num(n)}
          rangeLabel={t("designSystem.chartRange")}
        />
      </Section>

      <Section title={t("designSystem.secMotion")} reference="src/design-system/motion.ts">
        <MotionDemo t={t} />
      </Section>
    </>
  );
}

/** "07.2026": the same on server and client (Intl month names differ between Node and browsers). */
function monthLabel(monthIndex: number): string {
  return `${String(monthIndex + 1).padStart(2, "0")}.2026`;
}

/** Page transition, list items in and out, and a record opening from its row (shared layout). */
function MotionDemo({ t }: { t: T }) {
  const reduced = useReducedMotion();
  const [items, setItems] = useState([1, 2, 3, 4]);
  const [next, setNext] = useState(5);
  const [openId, setOpenId] = useState<number | null>(null);
  const [page, setPage] = useState<"list" | "chart">("list");

  return (
    <div className="ds-card ds-card-pad flex flex-col gap-4">
      <p className="ds-muted">{t("designSystem.motionNote")}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="ds-btn ds-btn-sm" onClick={() => {
            setItems((v) => [...v, next]);
            setNext((n) => n + 1);
          }}>
          <Plus className="h-3.5 w-3.5" aria-hidden /> {t("designSystem.motionAdd")}
        </button>
        <button type="button" className="ds-btn ds-btn-sm" onClick={() => setItems((v) => (v.length ? [...v.slice(1), v[0]] : v))}>
          <Shuffle className="h-3.5 w-3.5" aria-hidden /> {t("designSystem.motionShuffle")}
        </button>
        <button type="button" className="ds-btn ds-btn-sm" onClick={() => setPage((p) => (p === "list" ? "chart" : "list"))}>
          <BarChart3 className="h-3.5 w-3.5" aria-hidden /> {t("designSystem.motionPage")}
        </button>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={page} variants={motionPreset(pageVariants, reduced)} initial="initial" animate="enter" exit="exit">
          {page === "list" ? (
            <LayoutGroup>
              <motion.ul className="flex flex-col gap-2" variants={motionPreset(listVariants, reduced)} initial="initial" animate="enter">
                <AnimatePresence initial={false}>
                  {items.map((n) => (
                    <motion.li key={n} layout={!reduced} variants={motionPreset(listItemVariants, reduced)} initial="initial" animate="enter" exit="exit">
                      <motion.button
                        type="button"
                        layoutId={reduced ? undefined : recordLayoutId("demo-order", n)}
                        transition={transitions.layout}
                        onClick={() => setOpenId(n)}
                        className="ds-btn w-full justify-between"
                        style={{ height: "var(--ds-row-h)" }}
                      >
                        <span>{t("designSystem.motionItem", { n })}</span>
                        <span className="ds-mono ds-muted">{formatFigure(n * 112.5, 2)}</span>
                      </motion.button>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </motion.ul>
              <AnimatePresence>
                {openId !== null ? (
                  <motion.div
                    key="record"
                    layoutId={reduced ? undefined : recordLayoutId("demo-order", openId)}
                    transition={transitions.layout}
                    className="ds-panel mt-3 p-5"
                    role="region"
                    aria-label={t("designSystem.motionRecord", { n: openId })}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-semibold">{t("designSystem.motionRecord", { n: openId })}</h4>
                      <button type="button" className="ds-btn ds-btn-ghost ds-btn-sm" aria-label={t("designSystem.motionClose")} onClick={() => setOpenId(null)}>
                        <X className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                    <p className="mt-2 ds-muted ds-mono">{formatFigure(openId * 112.5, 2)} AZN</p>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </LayoutGroup>
          ) : (
            <div className="grid h-32 place-items-center ds-muted" style={{ border: "1px dashed var(--ds-border)", borderRadius: "var(--ds-radius-lg)" }}>
              {t("designSystem.motionOtherPage")}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
