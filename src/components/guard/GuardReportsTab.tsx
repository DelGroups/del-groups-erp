"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, FileText, Printer } from "lucide-react";
import { StandardGrid, type StandardColumn } from "@/components/lists/StandardGrid";
import { Button, Drawer, EmptyState, ErrorState, LoadingState, useToast } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { stateLabels } from "@/i18n/uiUnifiedLabels";
import { formatGridDateTime } from "@/lib/dates/localeDate";
import { downloadBlob, writeSheetBytes, XLSX_MIME, type XlsxModule } from "@/lib/export/exportXlsx";
import { patchBoldRows } from "@/lib/export/invoiceExport";
import { isoDay } from "@/lib/home/dates";
import { buildReportSheet, type SheetColumn } from "@/lib/reports/debtorReport";
import { getGuardReportAction, listGuardReportsAction } from "@/lib/actions/accountingGuardSection";
import { guardFindingsHref, isSeverity, isStatus, type GuardReport } from "@/lib/guard/findings";
import { GUARD_KEYS } from "./guardUi";
import { ReportBody } from "./ReportBody";
import { ReportPrint } from "./GuardPrintLayout";

type SnapshotRow = { rule: string; severity: string; status: string; doc_no: string | null; doc_date: string | null; partner: string | null; amount: number | null; first_seen: string | null };

/** The rows a snapshot report stored (kind 'scan'), for its Excel file; none for other reports. */
export function snapshotRows(summary: Record<string, unknown>): SnapshotRow[] {
  const list = Array.isArray(summary.findings) ? (summary.findings as Record<string, unknown>[]) : [];
  return list.flatMap((r) =>
    typeof r.rule === "string" && isSeverity(r.severity) && isStatus(r.status)
      ? [{ rule: r.rule, severity: r.severity, status: r.status, doc_no: typeof r.doc_no === "string" ? r.doc_no : null, doc_date: typeof r.doc_date === "string" ? r.doc_date : null, partner: typeof r.partner === "string" ? r.partner : null, amount: typeof r.amount === "number" ? r.amount : null, first_seen: typeof r.first_seen === "string" ? r.first_seen : null }]
      : [],
  );
}

/** The saved reports: snapshots of the findings, the accountant's reports (GUARD-5) and questions. */
export default function GuardReportsTab() {
  const { t } = useI18n();
  const states = stateLabels(t);
  const g = (key: string, p?: Record<string, string | number>) => t(`guard.ui.${key}`, p);
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: GUARD_KEYS.reports,
    queryFn: async () => {
      const r = await listGuardReportsAction();
      if (!r.success) throw new Error(t(r.error));
      return r.data;
    },
  });

  const columns: StandardColumn<GuardReport>[] = [
    { key: "title", header: g("colTitle"), width: 340, className: "font-medium", cell: (r) => r.title, sortValue: (r) => r.title },
    { key: "kind", header: g("colKind"), width: 140, cell: (r) => t(`guard.kind.${r.kind}`), sortValue: (r) => r.kind },
    { key: "by", header: g("colAuthor"), width: 150, cell: (r) => t(`guard.by.${r.createdByType}`), sortValue: (r) => r.createdByType },
    { key: "created", header: g("colCreated"), type: "datetime", cell: (r) => formatGridDateTime(r.createdAt), sortValue: (r) => r.createdAt },
  ];

  if (list.isError) return <ErrorState title={states.errorTitle} description={list.error instanceof Error ? list.error.message : undefined} retryLabel={states.retry} onRetry={() => void list.refetch()} />;
  if (!list.data) return <LoadingState label={states.loading} rows={6} />;
  if (list.data.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title={g("noReports")}
        description={g("noReportsHelp")}
        action={
          <Button variant="secondary" asChild>
            <Link href={guardFindingsHref()}>{g("goToFindings")}</Link>
          </Button>
        }
      />
    );
  }
  return (
    <>
      <StandardGrid<GuardReport> id="guard-reports" label={g("tab_reports")} rows={list.data} rowKey={(r) => r.id} columns={columns} onOpen={(r) => setOpenId(r.id)} />
      <ReportPanel id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

function ReportPanel({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const g = (key: string, p?: Record<string, string | number>) => t(`guard.ui.${key}`, p);
  const [printing, setPrinting] = useState(false);
  const report = useQuery({
    queryKey: GUARD_KEYS.report(id ?? ""),
    enabled: !!id,
    queryFn: async () => {
      const r = await getGuardReportAction(id!);
      if (!r.success) throw new Error(t(r.error));
      return r.data;
    },
  });

  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener("afterprint", done, { once: true });
    const timer = window.setTimeout(() => window.print(), 50);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", done);
    };
  }, [printing]);

  const data = report.data;
  const rows = data ? snapshotRows(data.summary) : [];

  const exportXlsx = async () => {
    if (!data) return;
    try {
      const columns: SheetColumn<SnapshotRow>[] = [
        { header: g("colSeverity"), kind: "text", value: (r) => t(`guard.severity.${r.severity}`) },
        { header: g("colRule"), kind: "text", value: (r) => `${r.rule} · ${t(`guard.rule.${r.rule}`)}` },
        { header: g("colStatus"), kind: "text", value: (r) => t(`guard.status.${r.status}`) },
        { header: g("colDocument"), kind: "text", value: (r) => r.doc_no },
        { header: g("colDate"), kind: "date", value: (r) => r.doc_date },
        { header: g("colPartner"), kind: "text", value: (r) => r.partner },
        { header: g("colAmount"), kind: "money", value: (r) => r.amount },
        { header: g("colFirstSeen"), kind: "date", value: (r) => r.first_seen },
      ];
      const sheet = buildReportSheet({ name: g("tab_findings"), title: data.title, filterLines: [[g("colCreated"), formatGridDateTime(data.createdAt)]], columns, rows, totalsLabel: g("total") });
      const XLSX = (await import("xlsx")) as unknown as XlsxModule;
      const bold = sheet.boldRows.map((r) => r + 1);
      const bytes = writeSheetBytes(XLSX, { name: sheet.name.slice(0, 31), rows: sheet.rows, widths: sheet.widths }, (xml, style) => patchBoldRows(xml, style, bold));
      downloadBlob(new Blob([bytes as BlobPart], { type: XLSX_MIME }), `accounting-guard-report-${isoDay(new Date(data.createdAt))}.xlsx`);
    } catch {
      toast(t("common.error"), g("exportFailed"), "error");
    }
  };

  return (
    <>
      <Drawer
        open={!!id}
        onOpenChange={(next) => (next ? undefined : onClose())}
        title={data?.title ?? g("tab_reports")}
        labels={{ close: t("common.close") }}
        footer={
          data ? (
            <>
              <Button variant="secondary" icon={Printer} onClick={() => setPrinting(true)}>
                {g("exportPdf")}
              </Button>
              <Button variant="secondary" icon={FileSpreadsheet} onClick={() => void exportXlsx()} disabled={rows.length === 0} title={rows.length === 0 ? g("noExcelForReport") : undefined}>
                {g("exportExcel")}
              </Button>
            </>
          ) : undefined
        }
      >
        {report.isError ? (
          <p role="alert" className="text-[length:var(--ds-text-sm)]">
            {report.error instanceof Error ? report.error.message : g("historyFailed")}
          </p>
        ) : !data ? (
          <p className="ds-muted text-[length:var(--ds-text-sm)]">{t("common.loading")}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="ds-muted text-[length:var(--ds-text-xs)]">
              {t(`guard.kind.${data.kind}`)} · {formatGridDateTime(data.createdAt)} · {t(`guard.by.${data.createdByType}`)}
              {data.model ? ` · ${data.model}` : ""}
            </p>
            <ReportBody body={data.body} />
          </div>
        )}
      </Drawer>
      {printing && data ? <ReportPrint report={data} /> : null}
    </>
  );
}
