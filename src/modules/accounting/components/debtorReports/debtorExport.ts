"use client";

import { downloadBlob, writeSheetBytes, XLSX_MIME, type XlsxModule } from "@/lib/export/exportXlsx";
import { patchBoldRows } from "@/lib/export/invoiceExport";
import { formatGridDate } from "@/lib/dates/localeDate";
import {
  buildReportSheet,
  debtorFileName,
  type BalanceRow,
  type DebtorQuery,
  type SheetColumn,
  type TurnoverRow,
} from "@/lib/reports/debtorReport";
import type { PrintData } from "./DebtorReportPrintLayout";

type T = (key: string, params?: Record<string, string | number>) => string;

/** The header lines of the Excel file and the print: as-of date or period, then every filter set. */
export function filterLines(q: DebtorQuery, t: T, personName: string): [string, string][] {
  const k = (key: string, p?: Record<string, string | number>) => t(`debtorReports.${key}`, p);
  const lines: [string, string][] = [[k("tabsLabel"), k(`tabs.${q.tab}`)]];
  if (q.tab === "turnover") lines.push([k("period"), `${formatGridDate(q.from)} — ${formatGridDate(q.to)}`]);
  else lines.push([k("asOf"), formatGridDate(q.asOf)]);
  if (q.type !== "all") lines.push([k("partnerType"), k(`types.${q.type}`)]);
  if (q.search) lines.push([k("search"), q.search]);
  if (q.minAmount !== null) lines.push([k("minAmount"), String(q.minAmount)]);
  if (q.currency) lines.push([k("currency"), q.currency]);
  if (q.userId) lines.push([k("person"), personName || q.userId]);
  if (q.overdueOnly) lines.push([k("overdueOnly"), k("yes")]);
  if (q.overLimitOnly) lines.push([k("overLimitOnly"), k("yes")]);
  return lines;
}

export function balanceColumns(t: T, tab: DebtorQuery["tab"]): SheetColumn<BalanceRow>[] {
  const k = (key: string) => t(`debtorReports.${key}`);
  return [
    { header: k("cols.partner"), kind: "text", value: (r) => r.name },
    { header: k("cols.phone"), kind: "text", value: (r) => r.phone },
    { header: k(`cols.balance_${tab}`), kind: "money", value: (r) => r.balance },
    { header: k("cols.overdue"), kind: "money", value: (r) => r.overdue },
    { header: k("cols.oldestDays"), kind: "number", value: (r) => r.oldestOverdueDays },
    { header: k("cols.openCount"), kind: "number", value: (r) => r.openCount },
    { header: k("cols.creditLimit"), kind: "money", value: (r) => r.creditLimit || null },
    { header: k("cols.usedPct"), kind: "percent", value: (r) => r.creditUsedPct },
    { header: k("cols.lastPayment"), kind: "date", value: (r) => r.lastPaymentDate },
    { header: k("cols.lastPaymentAmount"), kind: "money", value: (r) => r.lastPaymentAmount },
    { header: k("cols.terms"), kind: "number", value: (r) => r.paymentTermsDays },
  ];
}

export function turnoverColumns(t: T): SheetColumn<TurnoverRow>[] {
  const k = (key: string) => t(`debtorReports.${key}`);
  return [
    { header: k("cols.partner"), kind: "text", value: (r) => r.name },
    { header: k("cols.opening"), kind: "money", value: (r) => r.opening },
    { header: k("cols.debit"), kind: "money", value: (r) => r.debit },
    { header: k("cols.credit"), kind: "money", value: (r) => r.credit },
    { header: k("cols.closing"), kind: "money", value: (r) => r.closing },
    { header: k("cols.dso"), kind: "number", value: (r) => r.dso },
    { header: k("cols.dpo"), kind: "number", value: (r) => r.dpo },
  ];
}

/** Every row of the view as one sheet, with the filters in the header block. */
export async function downloadDebtorXlsx(q: DebtorQuery, data: PrintData, lines: [string, string][], t: T): Promise<void> {
  const title = t("nav.items.debtorReports");
  const totalsLabel = t("debtorReports.totals");
  const sheet =
    data.kind === "turnover"
      ? buildReportSheet({
          name: t("debtorReports.tabs.turnover"),
          title,
          filterLines: lines,
          columns: turnoverColumns(t),
          rows: data.report.rows,
          totals: { 1: data.report.totals.opening, 2: data.report.totals.debit, 3: data.report.totals.credit, 4: data.report.totals.closing, 5: data.report.totals.dso, 6: data.report.totals.dpo },
          totalsLabel,
        })
      : buildReportSheet({
          name: t(`debtorReports.tabs.${q.tab}`),
          title,
          filterLines: lines,
          columns: balanceColumns(t, q.tab),
          rows: data.report.rows,
          totals: { 2: data.report.totals.balance, 3: data.report.totals.overdue, 5: data.report.totals.openCount },
          totalsLabel,
        });
  const XLSX = (await import("xlsx")) as unknown as XlsxModule;
  const bold = sheet.boldRows.map((r) => r + 1);
  const bytes = writeSheetBytes(XLSX, { name: sheet.name.slice(0, 31), rows: sheet.rows, widths: sheet.widths }, (xml, style) => patchBoldRows(xml, style, bold));
  downloadBlob(new Blob([bytes as BlobPart], { type: XLSX_MIME }), debtorFileName(q, "xlsx"));
}
