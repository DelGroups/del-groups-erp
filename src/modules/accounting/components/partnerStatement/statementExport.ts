"use client";

import { downloadBlob, writeSheetBytes, XLSX_MIME, type XlsxModule } from "@/lib/export/exportXlsx";
import { patchBoldRows } from "@/lib/export/invoiceExport";
import {
  buildStatementSheet,
  sourceGroup,
  statementFileName,
  statementStatus,
  type PartnerStatement,
  type StatementSheetLabels,
} from "@/lib/reports/partnerStatement";

type T = (key: string, params?: Record<string, string | number>) => string;

/** The Excel labels in the user's language. */
export function statementSheetLabels(t: T, s: PartnerStatement, companyName: string): StatementSheetLabels {
  const k = (key: string) => t(`partnerStatement.${key}`);
  return {
    title: t("nav.items.partnerStatement"),
    partner: k("partner"),
    voen: k("voen"),
    phone: k("phone"),
    creditLimit: k("creditLimit"),
    paymentTerms: k("paymentTermsExcel"),
    period: k("period"),
    allTime: k("allTime"),
    side: k("side"),
    sideName: k(`sides.${s.side}`),
    company: k("company"),
    companyName,
    opening: k("openingRow"),
    closing: k("closing"),
    status: k("statusLabel"),
    statusName: k(`status.${statementStatus(s.closingBalance)}`),
    totals: k("totalsRow"),
    subtotals: k("subtotals"),
    cols: {
      date: k("cols.date"),
      type: k("cols.type"),
      docNo: k("cols.docNo"),
      description: k("cols.description"),
      debit: k("cols.debit"),
      credit: k("cols.credit"),
      balance: k("cols.balance"),
      currency: k("cols.currency"),
      amountFc: k("cols.amountFc"),
      createdBy: k("cols.createdBy"),
    },
    typeName: (sourceType) => k(`source.${sourceGroup(sourceType)}`),
  };
}

/** Builds statement-<partner>-<from>-<to>.xlsx in the browser and downloads it. */
export async function downloadStatementXlsx(s: PartnerStatement, labels: StatementSheetLabels): Promise<void> {
  const XLSX = (await import("xlsx")) as unknown as XlsxModule;
  const sheet = buildStatementSheet(s, labels);
  const bold = sheet.boldRows.map((r) => r + 1);
  const bytes = writeSheetBytes(XLSX, { name: sheet.name, rows: sheet.rows, widths: sheet.widths }, (xml, style) => patchBoldRows(xml, style, bold));
  downloadBlob(new Blob([bytes as BlobPart], { type: XLSX_MIME }), statementFileName(s.partner.name, s.from, s.to, "xlsx"));
}
