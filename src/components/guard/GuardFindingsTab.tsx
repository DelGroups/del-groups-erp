"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, FileSpreadsheet, FileText, Printer, X } from "lucide-react";
import { StandardGrid, type StandardColumn } from "@/components/lists/StandardGrid";
import { Button, Combobox, DateField, Dialog, Drawer, ErrorState, Field, LoadingState, Toolbar, useToast, type GridSelection } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { comboboxLabels, dateFieldLabels } from "@/i18n/uiStandardLabels";
import { stateLabels } from "@/i18n/uiUnifiedLabels";
import { formatGridDate, formatGridDateTime, formatMoney } from "@/lib/dates/localeDate";
import { downloadBlob, writeSheetBytes, XLSX_MIME, type XlsxModule } from "@/lib/export/exportXlsx";
import { patchBoldRows } from "@/lib/export/invoiceExport";
import { buildReportSheet } from "@/lib/reports/debtorReport";
import { isoDay } from "@/lib/home/dates";
import { guardFindingEventsAction, listGuardFindingsAction, saveGuardScanReportAction, setGuardFindingsStatusAction } from "@/lib/actions/accountingGuardSection";
import { findingColumns, findingFilterLines, findingsFileName } from "@/lib/guard/export";
import {
  GUARD_CATEGORIES,
  GUARD_SEVERITIES,
  GUARD_ACTIVE_STATUSES,
  countBySeverity,
  filterFindings,
  findingDocHref,
  normalizeReason,
  partnerHref,
  scanReportMarkdown,
  scanReportSummary,
  type GuardFinding,
  type GuardQuery,
  type GuardStatus,
} from "@/lib/guard/findings";
import { GUARD_KEYS, Fact, SeverityChip, StatusChip, ruleTitle } from "./guardUi";
import { FindingsPrint } from "./GuardPrintLayout";

const STATUS_FILTERS = ["active", "open", "acknowledged", "resolved", "auto_resolved", "false_positive", "all"] as const;

/** A finding's own facts shown in the panel, with a readable label (the key as text when we have no label). */
function factEntries(details: Record<string, unknown>): [string, string][] {
  const out: [string, string][] = [];
  for (const [key, value] of Object.entries(details)) {
    if (key === "products" || key === "product_ids" || value === null || value === undefined || value === "") continue;
    if (typeof value === "object") {
      out.push([key, Array.isArray(value) ? `${value.length}` : JSON.stringify(value)]);
    } else {
      out.push([key, String(value)]);
    }
  }
  return out;
}

/**
 * The Findings tab: filters (severity, category, rule, status, dates, partner, created by, search;
 * the URL keeps them), the grid with a side panel for one finding, bulk "Seen", and the exports
 * (Excel, PDF through the print dialog, a saved report).
 */
export default function GuardFindingsTab({ q, setQuery }: { q: GuardQuery; setQuery: (patch: Partial<GuardQuery>) => void }) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const states = stateLabels(t);
  const g = (key: string, p?: Record<string, string | number>) => t(`guard.ui.${key}`, p);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<"xlsx" | "print" | "report" | "bulk" | null>(null);
  const [printing, setPrinting] = useState<{ findings: GuardFinding[]; lines: [string, string][] } | null>(null);

  const data = useQuery({
    queryKey: GUARD_KEYS.findings,
    queryFn: async () => {
      const r = await listGuardFindingsAction();
      if (!r.success) throw new Error(r.error.startsWith("guard.") || r.error.startsWith("accountingGuard.") ? t(r.error) : r.error);
      return r.data;
    },
  });

  const all = useMemo(() => data.data?.findings ?? [], [data.data]);
  const rows = useMemo(() => filterFindings(all, q), [all, q]);
  const counts = useMemo(() => countBySeverity(rows), [rows]);
  const open = q.finding ? (all.find((f) => f.id === q.finding) ?? null) : null;

  // Search waits for a pause in typing.
  const [search, setSearch] = useState(q.search);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearch = (value: string) => {
    setSearch(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setQuery({ search: value.trim() }), 350);
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const refresh = useCallback(() => {
    setSelected(new Set());
    void queryClient.invalidateQueries({ queryKey: GUARD_KEYS.all });
  }, [queryClient]);

  const selection: GuardSelection = useMemo(() => {
    const shown = rows;
    return {
      isSelected: (f) => selected.has(f.id),
      toggle: (f) =>
        setSelected((cur) => {
          const next = new Set(cur);
          if (!next.delete(f.id)) next.add(f.id);
          return next;
        }),
      allSelected: shown.length > 0 && shown.every((f) => selected.has(f.id)),
      someSelected: shown.some((f) => selected.has(f.id)),
      toggleAll: () => setSelected((cur) => (shown.length > 0 && shown.every((f) => cur.has(f.id)) ? new Set() : new Set(shown.slice(0, 500).map((f) => f.id)))),
    };
  }, [rows, selected]);

  const names = { partner: data.data?.partners.find((p) => p.id === q.partner)?.name ?? null, creator: data.data?.creators.find((c) => c.id === q.creator)?.name ?? null };
  const lines = () => findingFilterLines(q, t, names);

  const exportXlsx = async () => {
    setBusy("xlsx");
    try {
      const sheet = buildReportSheet({ name: g("tab_findings"), title: g("printTitle"), filterLines: lines(), columns: findingColumns(t), rows, totalsLabel: g("total") });
      const XLSX = (await import("xlsx")) as unknown as XlsxModule;
      const bold = sheet.boldRows.map((r) => r + 1);
      const bytes = writeSheetBytes(XLSX, { name: sheet.name.slice(0, 31), rows: sheet.rows, widths: sheet.widths }, (xml, style) => patchBoldRows(xml, style, bold));
      downloadBlob(new Blob([bytes as BlobPart], { type: XLSX_MIME }), findingsFileName(isoDay(new Date())));
    } catch {
      toast(t("common.error"), g("exportFailed"), "error");
    } finally {
      setBusy(null);
    }
  };

  const print = () => {
    setBusy("print");
    setPrinting({ findings: rows, lines: lines() });
  };
  useEffect(() => {
    if (!printing) return;
    const done = () => {
      setPrinting(null);
      setBusy(null);
    };
    window.addEventListener("afterprint", done, { once: true });
    const id = window.setTimeout(() => window.print(), 50);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("afterprint", done);
    };
  }, [printing]);

  const saveReport = async () => {
    setBusy("report");
    const today = formatGridDate(isoDay(new Date()));
    const title = g("reportTitle", { date: today });
    const body = scanReportMarkdown(rows, {
      title,
      counts: g("reportCounts"),
      severity: (s) => t(`guard.severity.${s}`),
      rule: (code) => t(`guard.rule.${code}`),
      none: g("noFindings"),
      amount: (v) => formatMoney(v, locale, { currency: "AZN", decimals: 2 }),
    });
    const result = await saveGuardScanReportAction({ title, body, summary: scanReportSummary(rows) });
    setBusy(null);
    if (!result.success) {
      toast(t("common.error"), t(result.error), "error");
      return;
    }
    toast(g("reportSaved"), undefined, "success");
    void queryClient.invalidateQueries({ queryKey: GUARD_KEYS.reports });
    void queryClient.invalidateQueries({ queryKey: GUARD_KEYS.bell });
  };

  const bulkAcknowledge = async () => {
    setBusy("bulk");
    const result = await setGuardFindingsStatusAction([...selected], "acknowledged");
    setBusy(null);
    if (!result.success) {
      toast(t("common.error"), t(result.error), "error");
      return;
    }
    toast(g("acknowledgedCount", { count: result.data.changed }), undefined, "success");
    refresh();
  };

  const columns: StandardColumn<GuardFinding>[] = [
    { key: "severity", header: g("colSeverity"), width: 110, cell: (f) => <SeverityChip severity={f.severity} />, sortValue: (f) => GUARD_SEVERITIES.indexOf(f.severity) },
    { key: "rule", header: g("colRule"), width: 300, cell: (f) => ruleTitle(t, f.rule), sortValue: (f) => f.rule },
    {
      key: "doc",
      header: g("colDocument"),
      width: 140,
      cell: (f) => {
        const href = findingDocHref(f.entityType, f.entityId);
        return href && f.docNo ? (
          <Link href={href} className="hover:underline" onClick={(e) => e.stopPropagation()}>
            {f.docNo}
          </Link>
        ) : (
          (f.docNo ?? "—")
        );
      },
      sortValue: (f) => f.docNo,
    },
    { key: "date", header: g("colDate"), type: "date", cell: (f) => (f.docDate ? formatGridDate(f.docDate) : "—"), sortValue: (f) => f.docDate },
    { key: "partner", header: g("colPartner"), width: 180, cell: (f) => f.partnerName ?? "—", sortValue: (f) => f.partnerName },
    { key: "amount", header: g("colAmount"), type: "money", cell: (f) => (f.amount === null ? "—" : formatMoney(f.amount, locale, { currency: "AZN", decimals: 2 })), sortValue: (f) => f.amount },
    { key: "status", header: g("colStatus"), width: 140, cell: (f) => <StatusChip status={f.status} />, sortValue: (f) => f.status },
    { key: "seen", header: g("colFirstSeen"), type: "date", cell: (f) => formatGridDate(f.firstSeenAt), sortValue: (f) => f.firstSeenAt },
  ];

  const dateLabels = dateFieldLabels(t);
  const comboLabels = comboboxLabels(t);
  const ruleCodes = useMemo(() => [...new Set(all.map((f) => f.rule))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [all]);
  const filtered = !!(q.severity || q.category || q.rule || q.from || q.to || q.partner || q.creator || q.entity || q.search || q.status !== "active");

  if (data.isError) return <ErrorState title={states.errorTitle} description={data.error instanceof Error ? data.error.message : undefined} retryLabel={states.retry} onRetry={() => void data.refetch()} />;
  if (!data.data) return <LoadingState label={states.loading} rows={8} />;

  return (
    <div className="flex flex-col gap-3">
      <Toolbar
        label={g("filters")}
        start={
          <div className="flex w-full flex-wrap items-end gap-3">
            <Field label={g("colSeverity")}>
              {({ id }) => (
                <Combobox id={id} value={q.severity} clearable width="sm" labels={{ ...comboLabels, placeholder: g("anySeverity") }} options={GUARD_SEVERITIES.map((s) => ({ value: s, label: t(`guard.severity.${s}`) }))} onChange={(v) => setQuery({ severity: (v as GuardQuery["severity"]) ?? null })} />
              )}
            </Field>
            <Field label={g("colCategory")}>
              {({ id }) => (
                <Combobox id={id} value={q.category} clearable width="sm" labels={{ ...comboLabels, placeholder: g("anyCategory") }} options={GUARD_CATEGORIES.map((c) => ({ value: c, label: t(`guard.category.${c}`) }))} onChange={(v) => setQuery({ category: (v as GuardQuery["category"]) ?? null })} />
              )}
            </Field>
            <Field label={g("colRule")}>
              {({ id }) => <Combobox id={id} value={q.rule} clearable labels={{ ...comboLabels, placeholder: g("anyRule") }} options={ruleCodes.map((c) => ({ value: c, label: ruleTitle(t, c) }))} onChange={(v) => setQuery({ rule: v ?? null })} />}
            </Field>
            <Field label={g("colStatus")}>
              {({ id }) => (
                <Combobox id={id} value={q.status} width="sm" labels={comboLabels} options={STATUS_FILTERS.map((s) => ({ value: s, label: s === "active" ? g("statusActive") : s === "all" ? g("statusAll") : t(`guard.status.${s}`) }))} onChange={(v) => setQuery({ status: (v as GuardQuery["status"]) ?? "active" })} />
              )}
            </Field>
            <Field label={g("from")}>{({ id }) => <DateField id={id} value={q.from ?? ""} locale={locale} labels={dateLabels} onChange={(v) => setQuery({ from: v || null })} />}</Field>
            <Field label={g("to")}>{({ id }) => <DateField id={id} value={q.to ?? ""} locale={locale} labels={dateLabels} onChange={(v) => setQuery({ to: v || null })} />}</Field>
            <Field label={g("colPartner")}>
              {({ id }) => <Combobox id={id} value={q.partner} clearable labels={{ ...comboLabels, placeholder: g("anyone") }} options={data.data.partners.map((p) => ({ value: p.id, label: p.name }))} onChange={(v) => setQuery({ partner: v ?? null })} />}
            </Field>
            <Field label={g("colCreatedBy")}>
              {({ id }) => <Combobox id={id} value={q.creator} clearable labels={{ ...comboLabels, placeholder: g("anyone") }} options={data.data.creators.map((p) => ({ value: p.id, label: p.name }))} onChange={(v) => setQuery({ creator: v ?? null })} />}
            </Field>
            <Field label={g("search")} className="min-w-[12rem] flex-1">
              {({ id }) => <input id={id} className="ds-input w-full" value={search} placeholder={g("searchPlaceholder")} onChange={(e) => onSearch(e.target.value)} />}
            </Field>
          </div>
        }
        end={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" icon={FileSpreadsheet} onClick={() => void exportXlsx()} loading={busy === "xlsx"} disabled={busy !== null || rows.length === 0}>
              {g("exportExcel")}
            </Button>
            <Button variant="secondary" icon={Printer} onClick={print} loading={busy === "print"} disabled={busy !== null || rows.length === 0}>
              {g("exportPdf")}
            </Button>
            <Button variant="secondary" icon={FileText} onClick={() => void saveReport()} loading={busy === "report"} disabled={busy !== null || rows.length === 0}>
              {g("saveReport")}
            </Button>
          </div>
        }
      />

      {q.entity ? (
        <p className="flex flex-wrap items-center gap-2 text-[length:var(--ds-text-sm)]">
          <span className="ds-chip ds-chip-flat">{g("documentTypeFilter", { type: q.entity })}</span>
          <Button variant="ghost" size="sm" icon={X} onClick={() => setQuery({ entity: null })}>
            {g("clearFilter")}
          </Button>
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 text-[length:var(--ds-text-sm)]" role="status">
        <span>
          {rows.length === 0 ? g("noFindings") : g("showing", { count: rows.length })}
          {rows.length > 0 ? ` · ${GUARD_SEVERITIES.filter((s) => counts[s] > 0).map((s) => `${t(`guard.severity.${s}`)} ${counts[s]}`).join(", ")}` : ""}
        </span>
        {data.data.truncated ? <span className="ds-muted">{g("truncated")}</span> : null}
        {selected.size > 0 ? (
          <span className="flex items-center gap-2">
            <span>{g("selected", { count: selected.size })}</span>
            <Button variant="secondary" size="sm" icon={CheckCheck} onClick={() => void bulkAcknowledge()} loading={busy === "bulk"} disabled={busy !== null}>
              {g("acknowledgeSelected")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              {g("clearSelection")}
            </Button>
          </span>
        ) : null}
      </div>

      <StandardGrid<GuardFinding>
        id="guard-findings"
        label={g("tab_findings")}
        rows={rows}
        rowKey={(f) => f.id}
        columns={columns}
        selection={selection}
        onOpen={(f) => setQuery({ finding: f.id })}
        empty={filtered ? g("noFindingsFiltered") : g("noFindingsYet")}
      />

      <FindingPanel finding={open} onClose={() => setQuery({ finding: null })} onChanged={refresh} />
      {printing ? <FindingsPrint findings={printing.findings} lines={printing.lines} /> : null}
    </div>
  );
}

type GuardSelection = GridSelection<GuardFinding>;

// ── The side panel of one finding ─────────────────────────────────────────

function FindingPanel({ finding, onClose, onChanged }: { finding: GuardFinding | null; onClose: () => void; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const g = (key: string, p?: Record<string, string | number>) => t(`guard.ui.${key}`, p);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<"resolved" | "false_positive" | null>(null);

  const events = useQuery({
    queryKey: GUARD_KEYS.events(finding?.id ?? ""),
    enabled: !!finding,
    queryFn: async () => {
      const r = await guardFindingEventsAction(finding!.id);
      if (!r.success) throw new Error(t(r.error));
      return r.data;
    },
  });

  const change = async (status: GuardStatus, note?: string) => {
    if (!finding) return false;
    setBusy(true);
    const result = await setGuardFindingsStatusAction([finding.id], status, note);
    setBusy(false);
    if (!result.success) {
      toast(t("common.error"), t(result.error), "error");
      return false;
    }
    toast(g("statusChanged", { status: t(`guard.status.${status}`) }), undefined, "success");
    onChanged();
    return true;
  };

  const docHref = finding ? findingDocHref(finding.entityType, finding.entityId) : null;
  const facts = finding ? factEntries(finding.details) : [];
  const active = finding ? GUARD_ACTIVE_STATUSES.includes(finding.status) : false;

  return (
    <>
      <Drawer
        open={!!finding}
        onOpenChange={(next) => (next ? undefined : onClose())}
        title={finding ? ruleTitle(t, finding.rule) : ""}
        labels={{ close: t("common.close") }}
        busy={busy}
        footer={
          finding ? (
            <>
              {finding.status === "open" ? (
                <Button variant="secondary" onClick={() => void change("acknowledged")} loading={busy} disabled={busy}>
                  {g("acknowledge")}
                </Button>
              ) : null}
              {active ? (
                <>
                  <Button variant="secondary" onClick={() => setAsk("resolved")} disabled={busy}>
                    {g("markResolved")}
                  </Button>
                  <Button variant="secondary" onClick={() => setAsk("false_positive")} disabled={busy}>
                    {g("markFalsePositive")}
                  </Button>
                </>
              ) : (
                <Button variant="secondary" onClick={() => void change("open")} loading={busy} disabled={busy}>
                  {g("reopen")}
                </Button>
              )}
            </>
          ) : undefined
        }
      >
        {finding ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityChip severity={finding.severity} />
              <StatusChip status={finding.status} />
              <span className="ds-muted text-[length:var(--ds-text-xs)]">{t(`guard.category.${finding.category}`)}</span>
            </div>
            <dl>
              <Fact label={g("colDocument")}>{docHref && finding.docNo ? <Link href={docHref} className="hover:underline">{finding.docNo}</Link> : (finding.docNo ?? "—")}</Fact>
              <Fact label={g("colDate")}>{finding.docDate ? formatGridDate(finding.docDate) : "—"}</Fact>
              <Fact label={g("colPartner")}>{finding.partnerName && partnerHref(finding.partnerId) ? <Link href={partnerHref(finding.partnerId) as string} className="hover:underline">{finding.partnerName}</Link> : (finding.partnerName ?? "—")}</Fact>
              <Fact label={g("colAmount")}>{finding.amount === null ? "—" : formatMoney(finding.amount, locale, { currency: "AZN", decimals: 2 })}</Fact>
              {finding.createdByName ? <Fact label={g("colCreatedBy")}>{finding.createdByName}</Fact> : null}
              <Fact label={g("colFirstSeen")}>{formatGridDateTime(finding.firstSeenAt)}</Fact>
              <Fact label={g("lastSeen")}>{formatGridDateTime(finding.lastSeenAt)}</Fact>
              {finding.note ? <Fact label={g("colNote")}>{finding.note}</Fact> : null}
            </dl>
            {facts.length > 0 ? (
              <section aria-label={g("details")}>
                <h3 className="mb-1 text-[length:var(--ds-text-sm)] font-semibold">{g("details")}</h3>
                <dl>
                  {facts.map(([key, value]) => {
                    const label = t(`guard.fact.${key}`);
                    return (
                      <Fact key={key} label={label === `guard.fact.${key}` ? key.replace(/_/g, " ") : label}>
                        {value}
                      </Fact>
                    );
                  })}
                </dl>
              </section>
            ) : null}
            <section aria-label={g("history")}>
              <h3 className="mb-1 text-[length:var(--ds-text-sm)] font-semibold">{g("history")}</h3>
              {events.isError ? (
                <p className="ds-muted text-[length:var(--ds-text-sm)]">{events.error instanceof Error ? events.error.message : g("historyFailed")}</p>
              ) : !events.data ? (
                <p className="ds-muted text-[length:var(--ds-text-sm)]">{t("common.loading")}</p>
              ) : events.data.length === 0 ? (
                <p className="ds-muted text-[length:var(--ds-text-sm)]">{g("noHistory")}</p>
              ) : (
                <ol className="flex flex-col gap-2 text-[length:var(--ds-text-sm)]">
                  {events.data.map((e) => (
                    <li key={e.id} className="border-s-2 border-[var(--ds-border)] ps-3">
                      <div>
                        {e.fromStatus ? `${t(`guard.status.${e.fromStatus}`)} → ` : ""}
                        <strong>{t(`guard.status.${e.toStatus}`)}</strong>
                      </div>
                      <div className="ds-muted text-[length:var(--ds-text-xs)]">
                        {formatGridDateTime(e.createdAt)} · {e.actorName ?? g("system")}
                      </div>
                      {e.note ? <div>{e.note}</div> : null}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        ) : null}
      </Drawer>

      {/* The key gives every opening a fresh, empty reason field. */}
      <ReasonDialog
        key={ask ?? "closed"}
        open={ask !== null}
        title={ask === "resolved" ? g("markResolved") : g("markFalsePositive")}
        label={ask === "resolved" ? g("resolvedReasonLabel") : g("falsePositiveReasonLabel")}
        confirmLabel={ask === "resolved" ? g("markResolved") : g("markFalsePositive")}
        busy={busy}
        onClose={() => setAsk(null)}
        onConfirm={async (reason) => {
          const ok = await change(ask as GuardStatus, reason);
          if (ok) setAsk(null);
          return ok;
        }}
      />
    </>
  );
}

/** Asks for the reason (required, at least three characters) before a finding is closed. */
export function ReasonDialog({ open, title, label, confirmLabel, busy, onClose, onConfirm }: { open: boolean; title: string; label: string; confirmLabel: string; busy: boolean; onClose: () => void; onConfirm: (reason: string) => Promise<boolean> }) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const text = normalizeReason(reason);
    if (!text) {
      setError(t("guard.errors.reasonRequired"));
      return;
    }
    await onConfirm(text);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      size="sm"
      title={title}
      labels={{ close: t("common.close") }}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Field label={label} required error={error ?? undefined}>
        {({ id, describedBy, invalid }) => (
          <textarea
            id={id}
            className="ds-input w-full"
            rows={3}
            maxLength={500}
            value={reason}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            onChange={(e) => {
              setReason(e.target.value);
              setError(null);
            }}
          />
        )}
      </Field>
    </Dialog>
  );
}

