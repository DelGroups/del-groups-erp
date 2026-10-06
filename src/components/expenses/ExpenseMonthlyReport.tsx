"use client";

import React, { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { downloadTextFile, rowsToCsv } from "@/lib/csv/csvUtils";
import {
  buildMonthlyReport,
  type ExpenseDocument,
  type ExpenseReportGroup,
} from "@/lib/expenses/expenseDocuments";

interface Props {
  rows: ExpenseDocument[];
  loading: boolean;
  /** Used in the CSV file name. */
  rangeLabel: string;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return `${m}.${y}`;
}

function money(value: number | undefined): string {
  return value ? value.toFixed(2) : "—";
}

export default function ExpenseMonthlyReport({ rows, loading, rangeLabel }: Props) {
  const { t } = useI18n();
  const [group, setGroup] = useState<ExpenseReportGroup>("category");
  const noLabel = group === "category" ? t("expenses.doc.reportNoCategory") : t("expenses.doc.reportNoDepartment");
  const report = useMemo(() => buildMonthlyReport(rows, group, noLabel), [rows, group, noLabel]);

  const exportCsv = () => {
    const headers = [
      group === "category" ? t("common.category") : t("expenses.doc.department"),
      ...report.months.map(monthLabel),
      t("expenses.doc.total"),
    ];
    const data = report.lines.map((line) => [
      line.label,
      ...report.months.map((m) => (line.byMonth[m] || 0).toFixed(2)),
      line.total.toFixed(2),
    ]);
    data.push([
      t("expenses.doc.total"),
      ...report.months.map((m) => (report.monthTotals[m] || 0).toFixed(2)),
      report.total.toFixed(2),
    ]);
    downloadTextFile(`xerc_hesabat_${group}_${rangeLabel}.csv`, rowsToCsv(headers, data));
  };

  return (
    <section className="app-card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-sm font-bold text-app">{t("expenses.doc.reportTitle")}</h3>
        {(["category", "department"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setGroup(key)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              group === key ? "bg-rose-600 text-white" : "bg-app-card-hover text-app-muted hover:text-app"
            }`}
          >
            {key === "category" ? t("expenses.doc.reportByCategory") : t("expenses.doc.reportByDepartment")}
          </button>
        ))}
        <button
          type="button"
          onClick={exportCsv}
          disabled={report.lines.length === 0}
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold text-app hover:bg-app-card-hover disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          {t("expenses.doc.exportCsv")}
        </button>
      </div>
      <p className="text-[11px] text-app-muted">{t("expenses.doc.reportHint")}</p>

      {loading && rows.length === 0 ? (
        <div className="p-8 text-center text-sm text-app-muted">{t("common.loading")}</div>
      ) : report.lines.length === 0 ? (
        <div className="p-8 text-center text-sm text-app-muted">{t("expenses.emptyRecords")}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="border-b border-app text-xs text-app-muted">
                <th className="sticky left-0 bg-[var(--app-card)] px-2 py-2 text-left font-semibold">
                  {group === "category" ? t("common.category") : t("expenses.doc.department")}
                </th>
                {report.months.map((m) => (
                  <th key={m} className="px-2 py-2 text-right font-semibold">
                    {monthLabel(m)}
                  </th>
                ))}
                <th className="px-2 py-2 text-right font-bold text-app">{t("expenses.doc.total")}</th>
              </tr>
            </thead>
            <tbody>
              {report.lines.map((line) => (
                <tr key={line.label} className="border-b border-app">
                  <td className="sticky left-0 max-w-[16rem] truncate bg-[var(--app-card)] px-2 py-1.5 text-app">
                    {line.label}
                  </td>
                  {report.months.map((m) => (
                    <td key={m} className="px-2 py-1.5 text-right tabular-nums text-app-muted">
                      {money(line.byMonth[m])}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-app">
                    {line.total.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold">
                <td className="sticky left-0 bg-[var(--app-card)] px-2 py-2 text-app">{t("expenses.doc.total")}</td>
                {report.months.map((m) => (
                  <td key={m} className="px-2 py-2 text-right tabular-nums text-app">
                    {money(report.monthTotals[m])}
                  </td>
                ))}
                <td className="px-2 py-2 text-right tabular-nums text-rose-600">{report.total.toFixed(2)} AZN</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
