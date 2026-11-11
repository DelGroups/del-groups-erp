"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, FileCheck2, FileSpreadsheet, Printer, Scale, UserRound } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import { LookupScope } from "@/components/lookups";
import { StandardGrid, type StandardColumn } from "@/components/lists/StandardGrid";
import { Button, Chip, Combobox, DateField, ErrorState, Field, IconButton, LoadingState, MoneyCell, SegmentedControl, Tabs, Toolbar } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { comboboxLabels, dateFieldLabels } from "@/i18n/uiStandardLabels";
import { stateLabels } from "@/i18n/uiUnifiedLabels";
import { formatGridDate, formatMoney } from "@/lib/dates/localeDate";
import { isoDay } from "@/lib/home/dates";
import { partnerStatementHref } from "@/lib/reports/partnerStatement";
import {
  DEBTOR_TABS,
  barWidths,
  debtorQueryString,
  nextSort,
  overCreditLimit,
  overduePct,
  pageCount,
  parseDebtorQuery,
  patchQuery,
  type BalanceReport,
  type BalanceRow,
  type DebtorQuery,
  type DebtorTab,
  type PartnerKind,
  type TurnoverReport,
  type TurnoverRow,
} from "@/lib/reports/debtorReport";
import { fetchBalanceReportAction, fetchReportPeopleAction, fetchTurnoverReportAction } from "../../actions/debtorReports";
import DebtorReportPrintLayout, { type PrintData } from "./DebtorReportPrintLayout";
import { downloadDebtorXlsx, filterLines } from "./debtorExport";

const KINDS: readonly PartnerKind[] = ["all", "customer", "supplier", "partner"];
const CURRENCIES = ["AZN", "USD", "EUR", "RUB", "TRY", "GBP", "CNY"];

/**
 * "Debitor və kreditor borcları" (LED-4, PARTNER_LEDGERS): debtors, creditors and net balances as
 * of a date, and turnover per partner for a period with DSO / DPO, all from the LED-1 ledger.
 * Every filter, the tab, the sort and the page live in the URL; the server pages and sorts
 * (one RPC call per view).
 */
export default function DebtorCreditorPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const today = useMemo(() => isoDay(new Date()), []);
  const q = useMemo(() => parseDebtorQuery(params, today), [params, today]);
  const states = stateLabels(t);
  const k = (key: string, p?: Record<string, string | number>) => t(`debtorReports.${key}`, p);

  const setQuery = useCallback(
    (patch: Partial<DebtorQuery>) => {
      const qs = debtorQueryString(patchQuery(q, patch), today);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, q, router, today]
  );

  // Search waits for a pause in typing.
  const [search, setSearch] = useState(q.search);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearch = (value: string) => {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setQuery({ search: value }), 350);
  };
  const [minDraft, setMinDraft] = useState(q.minAmount === null ? "" : String(q.minAmount));
  const commitMin = () => {
    const n = Number(minDraft.replace(",", "."));
    setQuery({ minAmount: minDraft.trim() && Number.isFinite(n) && n > 0 ? n : null });
  };

  const balance = useQuery({
    queryKey: ["debtor-report", q.tab, q.asOf, q.type, q.minAmount, q.currency, q.userId, q.overdueOnly, q.overLimitOnly, q.search, q.sort, q.dir, q.page, q.pageSize],
    enabled: q.tab !== "turnover",
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const r = await fetchBalanceReportAction(q);
      if (!r.success) throw new Error(r.error);
      return r.data;
    },
  });
  const turnover = useQuery({
    queryKey: ["partner-turnover", q.from, q.to, q.type, q.minAmount, q.currency, q.userId, q.overdueOnly, q.overLimitOnly, q.search, q.sort, q.dir, q.page, q.pageSize],
    enabled: q.tab === "turnover",
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const r = await fetchTurnoverReportAction(q);
      if (!r.success) throw new Error(r.error);
      return r.data;
    },
  });
  const people = useQuery({
    queryKey: ["debtor-report", "people"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const r = await fetchReportPeopleAction();
      if (!r.success) throw new Error(r.error);
      return r.data;
    },
  });
  const personName = (id: string) => people.data?.find((p) => p.id === id)?.name ?? "";

  const active = q.tab === "turnover" ? turnover : balance;
  const error = active.error ? (t(active.error.message) === active.error.message ? k("errors.load") : t(active.error.message)) : null;
  const total = q.tab === "turnover" ? turnover.data?.totalCount ?? 0 : balance.data?.totalCount ?? 0;
  const pages = pageCount(total, q.pageSize);

  // Export and print read every row of the view in one call.
  const [busy, setBusy] = useState<"xlsx" | "print" | null>(null);
  const [printData, setPrintData] = useState<PrintData | null>(null);
  const loadAll = async (): Promise<PrintData> => {
    if (q.tab === "turnover") {
      const r = await fetchTurnoverReportAction(q, true);
      if (!r.success) throw new Error(r.error);
      return { kind: "turnover", report: r.data };
    }
    const r = await fetchBalanceReportAction(q, true);
    if (!r.success) throw new Error(r.error);
    return { kind: "balance", report: r.data };
  };
  const lines = () => filterLines(q, t, personName(q.userId));
  const exportXlsx = async () => {
    setBusy("xlsx");
    try {
      await downloadDebtorXlsx(q, await loadAll(), lines(), t);
    } catch {
      toast.error(k("errors.export"));
    } finally {
      setBusy(null);
    }
  };
  const print = async () => {
    setBusy("print");
    try {
      setPrintData(await loadAll());
    } catch {
      toast.error(k("errors.export"));
      setBusy(null);
    }
  };
  useEffect(() => {
    if (!printData) return;
    const done = () => {
      setPrintData(null);
      setBusy(null);
    };
    window.addEventListener("afterprint", done, { once: true });
    const id = window.setTimeout(() => window.print(), 50);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("afterprint", done);
    };
  }, [printData]);

  const dateLabels = dateFieldLabels(t);
  const comboLabels = comboboxLabels(t);

  return (
    <PageLayout>
      <div className="print:hidden">
        <DocumentPageHeader
          icon={<Scale className="h-6 w-6 text-app-accent" />}
          title={t("nav.items.debtorReports")}
          description={k("description")}
          backLink={{ href: "/reports", label: t("nav.items.reports") }}
          extraActions={
            <LookupScope className="flex flex-wrap gap-2">
              <Button variant="secondary" icon={FileSpreadsheet} onClick={() => void exportXlsx()} loading={busy === "xlsx"} disabled={busy !== null || total === 0}>
                {k("exportExcel")}
              </Button>
              <Button variant="secondary" icon={Printer} onClick={() => void print()} loading={busy === "print"} disabled={busy !== null || total === 0}>
                {k("print")}
              </Button>
            </LookupScope>
          }
        />
      </div>

      <main className="app-page-content flex-1 print:hidden">
        <LookupScope className="flex flex-col gap-4">
          {q.tab === "turnover" ? <TurnoverKpis report={turnover.data} /> : <BalanceKpis report={balance.data} />}

          <Toolbar
            label={k("filters")}
            start={
              <div className="flex w-full flex-wrap items-end gap-3">
                {q.tab === "turnover" ? (
                  <>
                    <Field label={k("from")}>{({ id }) => <DateField id={id} value={q.from} locale={locale} labels={dateLabels} onChange={(v) => v && setQuery({ from: v > q.to ? q.to : v })} />}</Field>
                    <Field label={k("to")}>{({ id }) => <DateField id={id} value={q.to} locale={locale} labels={dateLabels} onChange={(v) => v && setQuery({ to: v, from: q.from > v ? v : q.from })} />}</Field>
                  </>
                ) : (
                  <Field label={k("asOf")}>{({ id }) => <DateField id={id} value={q.asOf} locale={locale} labels={dateLabels} onChange={(v) => v && setQuery({ asOf: v })} />}</Field>
                )}
                <Field label={k("partnerType")}>
                  {() => (
                    <SegmentedControl label={k("partnerType")} size="sm" value={q.type} onValueChange={(v) => setQuery({ type: v as PartnerKind })} options={KINDS.map((id) => ({ id, label: k(`types.${id}`) }))} />
                  )}
                </Field>
                <Field label={k("search")} className="min-w-[14rem] flex-1">
                  {({ id }) => <input id={id} className="ds-input w-full" value={search} placeholder={k("searchPlaceholder")} onChange={(e) => onSearch(e.target.value)} />}
                </Field>
                <Field label={k("minAmount")}>
                  {({ id }) => (
                    <input id={id} className="ds-input w-28" inputMode="decimal" value={minDraft} onChange={(e) => setMinDraft(e.target.value)} onBlur={commitMin} onKeyDown={(e) => e.key === "Enter" && commitMin()} />
                  )}
                </Field>
                <Field label={k("currency")}>
                  {({ id }) => (
                    <Combobox id={id} value={q.currency || null} clearable labels={{ ...comboLabels, placeholder: k("anyCurrency") }} width="sm" options={CURRENCIES.map((c) => ({ value: c, label: c }))} onChange={(v) => setQuery({ currency: v ?? "" })} />
                  )}
                </Field>
                <Field label={k("person")}>
                  {({ id }) => (
                    <Combobox
                      id={id}
                      value={q.userId || null}
                      clearable
                      labels={{ ...comboLabels, placeholder: k("anyone") }}
                      options={(people.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
                      onChange={(v) => setQuery({ userId: v ?? "" })}
                    />
                  )}
                </Field>
                <label className="flex min-h-9 items-center gap-2 text-[length:var(--ds-text-sm)]">
                  <input type="checkbox" checked={q.overdueOnly} onChange={(e) => setQuery({ overdueOnly: e.target.checked })} />
                  {k("overdueOnly")}
                </label>
                {q.tab !== "creditors" ? (
                  <label className="flex min-h-9 items-center gap-2 text-[length:var(--ds-text-sm)]">
                    <input type="checkbox" checked={q.overLimitOnly} onChange={(e) => setQuery({ overLimitOnly: e.target.checked })} />
                    {k("overLimitOnly")}
                  </label>
                ) : null}
              </div>
            }
          />

          <Tabs label={k("tabsLabel")} value={q.tab} onValueChange={(v) => setQuery({ tab: v as DebtorTab })} items={DEBTOR_TABS.map((id) => ({ id, label: k(`tabs.${id}`) }))}>
            {q.tab === "turnover" ? <p className="ds-muted mb-3 max-w-[72ch] text-[length:var(--ds-text-sm)]">{k("dsoHelp")}</p> : null}
            {error ? (
              <ErrorState title={states.errorTitle} description={error} retryLabel={states.retry} onRetry={() => void active.refetch()} />
            ) : !active.data ? (
              <LoadingState label={states.loading} rows={8} />
            ) : q.tab === "turnover" ? (
              <TurnoverGrid report={turnover.data as TurnoverReport} q={q} onSort={(key) => setQuery({ ...nextSort(q, key) })} loading={turnover.isFetching} />
            ) : (
              <BalanceGrid report={balance.data as BalanceReport} q={q} onSort={(key) => setQuery({ ...nextSort(q, key) })} loading={balance.isFetching} />
            )}
            {active.data && total > 0 ? (
              <nav aria-label={k("pages")} className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[length:var(--ds-text-sm)]">
                <span className="ds-muted">{k("shown", { from: (q.page - 1) * q.pageSize + 1, to: Math.min(q.page * q.pageSize, total), total })}</span>
                <span className="flex items-center gap-2">
                  <IconButton icon={<ChevronLeft className="h-4 w-4" />} label={k("previous")} size="sm" disabled={q.page <= 1} onClick={() => setQuery({ page: q.page - 1 })} />
                  <span aria-live="polite">{k("pageOf", { page: Math.min(q.page, pages), pages })}</span>
                  <IconButton icon={<ChevronRight className="h-4 w-4" />} label={k("next")} size="sm" disabled={q.page >= pages} onClick={() => setQuery({ page: q.page + 1 })} />
                  <SegmentedControl
                    label={k("pageSize")}
                    size="sm"
                    value={String(q.pageSize)}
                    onValueChange={(v) => setQuery({ pageSize: Number(v) })}
                    options={["25", "50", "100"].map((id) => ({ id, label: id }))}
                  />
                </span>
              </nav>
            ) : null}
          </Tabs>
        </LookupScope>
      </main>

      {printData ? <DebtorReportPrintLayout q={q} data={printData} lines={lines()} /> : null}
    </PageLayout>
  );
}

// ── KPI strip ─────────────────────────────────────────────────────────────

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className="ds-card flex min-w-0 flex-col gap-1 p-4">
      <span className="ds-muted truncate text-[length:var(--ds-text-xs)]">{label}</span>
      <span className="ds-num truncate text-[length:var(--ds-text-xl)] font-semibold tabular-nums" style={tone === "danger" ? { color: "var(--ds-danger-strong)" } : undefined}>
        {value}
      </span>
    </div>
  );
}

export function BalanceKpis({ report }: { report: BalanceReport | undefined }) {
  const { t, locale } = useI18n();
  const k = (key: string) => t(`debtorReports.${key}`);
  if (!report) return null;
  const money = (v: number) => formatMoney(v, locale, { currency: "AZN", decimals: 2 });
  const pct = overduePct(report.kpi);
  const top = report.kpi.topDebtors;
  const widths = barWidths(top.map((d) => d.balance));
  return (
    <section aria-label={k("kpiLabel")} className="flex flex-col gap-3">
      <div className="ds-kpi-grid">
        <Kpi label={k("kpi.receivable")} value={money(report.kpi.totalReceivable)} />
        <Kpi label={k("kpi.payable")} value={money(report.kpi.totalPayable)} />
        <Kpi label={k("kpi.net")} value={money(report.kpi.net)} />
        <Kpi label={k("kpi.overduePct")} value={pct === null ? "—" : `${formatMoney(pct, locale, { currency: null, decimals: 1 })} %`} tone={pct && pct > 0 ? "danger" : undefined} />
      </div>
      {top.length ? (
        <figure className="ds-card p-4">
          <figcaption className="mb-2 text-[length:var(--ds-text-sm)] font-semibold">{k("kpi.topDebtors")}</figcaption>
          <ol className="flex flex-col gap-1.5">
            {top.map((d, i) => (
              <li key={d.partnerId} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2 text-[length:var(--ds-text-xs)] sm:grid-cols-[minmax(0,16rem)_1fr_auto]">
                <Link href={partnerStatementHref(d.partnerId)} className="truncate hover:underline" title={d.name}>
                  {d.name}
                </Link>
                <span className="h-2.5 rounded-full" style={{ background: "var(--ds-brand-soft, var(--ds-surface-sunken))" }} aria-hidden>
                  <span className="block h-full rounded-full" style={{ width: `${widths[i]}%`, background: "var(--ds-brand)" }} />
                </span>
                <span className="ds-num tabular-nums">{money(d.balance)}</span>
              </li>
            ))}
          </ol>
        </figure>
      ) : null}
    </section>
  );
}

export function TurnoverKpis({ report }: { report: TurnoverReport | undefined }) {
  const { t, locale } = useI18n();
  const k = (key: string, p?: Record<string, string | number>) => t(`debtorReports.${key}`, p);
  if (!report) return null;
  const money = (v: number) => formatMoney(v, locale, { currency: "AZN", decimals: 2 });
  const days = (v: number | null) => (v === null ? "—" : k("days", { n: formatMoney(v, locale, { currency: null, decimals: 1 }) }));
  return (
    <section aria-label={k("kpiLabel")} className="ds-kpi-grid">
      <Kpi label={k("kpi.sales")} value={money(report.totals.sales)} />
      <Kpi label={k("kpi.purchases")} value={money(report.totals.purchases)} />
      <Kpi label={k("kpi.dso")} value={days(report.totals.dso)} />
      <Kpi label={k("kpi.dpo")} value={days(report.totals.dpo)} />
    </section>
  );
}

// ── Grids ─────────────────────────────────────────────────────────────────

function RowLinks({ partnerId }: { partnerId: string }) {
  const { t } = useI18n();
  return (
    <span className="flex items-center justify-center gap-1">
      <Link href={partnerStatementHref(partnerId)} className="ds-icon-btn ds-icon-btn-sm" aria-label={t("nav.items.partnerStatement")} title={t("nav.items.partnerStatement")}>
        <FileCheck2 className="h-4 w-4" aria-hidden />
      </Link>
      <Link href={`/dashboard/partners/${partnerId}`} className="ds-icon-btn ds-icon-btn-sm" aria-label={t("debtorReports.openPartner")} title={t("debtorReports.openPartner")}>
        <UserRound className="h-4 w-4" aria-hidden />
      </Link>
    </span>
  );
}

export function BalanceGrid({ report, q, onSort, loading }: { report: BalanceReport; q: DebtorQuery; onSort: (key: string) => void; loading: boolean }) {
  const { t, locale } = useI18n();
  const k = (key: string, p?: Record<string, string | number>) => t(`debtorReports.${key}`, p);
  const money = (v: number | null) => <MoneyCell value={v} locale={locale} currency={null} />;
  const columns: StandardColumn<BalanceRow>[] = [
    { key: "name", header: k("cols.partner"), sortable: true, cell: (r) => <span title={r.name}>{r.name}{r.isDeleted ? <span className="ds-muted"> · {k("deleted")}</span> : null}</span> },
    { key: "phone", header: k("cols.phone"), cell: (r) => r.phone || "—" },
    { key: "balance", header: k(`cols.balance_${q.tab}`), type: "money", sortable: true, className: "font-semibold", cell: (r) => money(r.balance) },
    {
      key: "overdue",
      header: k("cols.overdue"),
      type: "money",
      sortable: true,
      cell: (r) => (r.overdue > 0 ? <span style={{ color: "var(--ds-danger-strong)" }}>{money(r.overdue)}</span> : money(r.overdue || null)),
    },
    { key: "oldest_days", header: k("cols.oldestDays"), type: "number", sortable: true, cell: (r) => (r.oldestOverdueDays === null ? "—" : String(r.oldestOverdueDays)) },
    { key: "open_count", header: k("cols.openCount"), type: "number", sortable: true, cell: (r) => String(r.openCount) },
    { key: "credit_limit", header: k("cols.creditLimit"), type: "money", cell: (r) => money(r.creditLimit || null) },
    {
      key: "used_pct",
      header: k("cols.usedPct"),
      type: "number",
      sortable: true,
      samples: ["133,3 %"],
      cell: (r) =>
        r.creditUsedPct === null ? "—" : overCreditLimit(r) ? (
          <Chip tone="danger">{`${formatMoney(r.creditUsedPct, locale, { currency: null, decimals: 1 })} %`}</Chip>
        ) : (
          `${formatMoney(r.creditUsedPct, locale, { currency: null, decimals: 1 })} %`
        ),
    },
    { key: "last_payment_date", header: k("cols.lastPayment"), type: "date", sortable: true, cell: (r) => (r.lastPaymentDate ? formatGridDate(r.lastPaymentDate) : "—") },
    { key: "last_payment_amount", header: k("cols.lastPaymentAmount"), type: "money", cell: (r) => money(r.lastPaymentAmount) },
    { key: "terms", header: k("cols.terms"), type: "number", sortable: true, cell: (r) => (r.paymentTermsDays === null ? "—" : k("daysShort", { n: r.paymentTermsDays })) },
  ];
  return (
    <StandardGrid<BalanceRow>
      id={`debtor-report-${q.tab}`}
      label={k(`tabs.${q.tab}`)}
      rows={report.rows}
      rowKey={(r) => r.partnerId}
      columns={columns}
      loading={loading}
      sort={{ key: q.sort, dir: q.dir }}
      onSort={onSort}
      rowActions={(r) => <RowLinks partnerId={r.partnerId} />}
      actionsWidth={80}
      empty={k("empty")}
      totals={{ balance: money(report.totals.balance), overdue: money(report.totals.overdue), open_count: String(report.totals.openCount) }}
    />
  );
}

export function TurnoverGrid({ report, q, onSort, loading }: { report: TurnoverReport; q: DebtorQuery; onSort: (key: string) => void; loading: boolean }) {
  const { t, locale } = useI18n();
  const k = (key: string, p?: Record<string, string | number>) => t(`debtorReports.${key}`, p);
  const money = (v: number) => <MoneyCell value={v} locale={locale} currency={null} />;
  const days = (v: number | null) => (v === null ? "—" : formatMoney(v, locale, { currency: null, decimals: 1 }));
  const columns: StandardColumn<TurnoverRow>[] = [
    { key: "name", header: k("cols.partner"), sortable: true, cell: (r) => <span title={r.name}>{r.name}</span> },
    { key: "opening", header: k("cols.opening"), type: "money", sortable: true, cell: (r) => money(r.opening) },
    { key: "debit", header: k("cols.debit"), type: "money", sortable: true, cell: (r) => money(r.debit) },
    { key: "credit", header: k("cols.credit"), type: "money", sortable: true, cell: (r) => money(r.credit) },
    { key: "closing", header: k("cols.closing"), type: "money", sortable: true, className: "font-semibold", cell: (r) => money(r.closing) },
    { key: "dso", header: k("cols.dso"), type: "number", sortable: true, cell: (r) => days(r.dso) },
    { key: "dpo", header: k("cols.dpo"), type: "number", sortable: true, cell: (r) => days(r.dpo) },
  ];
  return (
    <StandardGrid<TurnoverRow>
      id="debtor-report-turnover"
      label={k("tabs.turnover")}
      rows={report.rows}
      rowKey={(r) => r.partnerId}
      columns={columns}
      loading={loading}
      sort={{ key: q.sort, dir: q.dir }}
      onSort={onSort}
      rowActions={(r) => <RowLinks partnerId={r.partnerId} />}
      actionsWidth={80}
      empty={k("empty")}
      totals={{
        opening: money(report.totals.opening),
        debit: money(report.totals.debit),
        credit: money(report.totals.credit),
        closing: money(report.totals.closing),
        dso: days(report.totals.dso),
        dpo: days(report.totals.dpo),
      }}
    />
  );
}
