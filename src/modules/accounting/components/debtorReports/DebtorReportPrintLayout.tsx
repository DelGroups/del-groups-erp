"use client";

import { useI18n } from "@/i18n/I18nProvider";
import { useCompanyProfile } from "@/hooks/useCompanyProfile";
import { formatGridDate, formatMoney } from "@/lib/dates/localeDate";
import type { BalanceReport, DebtorQuery, SheetColumn, TurnoverReport } from "@/lib/reports/debtorReport";
import { balanceColumns, turnoverColumns } from "./debtorExport";

export type PrintData = { kind: "balance"; report: BalanceReport } | { kind: "turnover"; report: TurnoverReport };

/**
 * The report on paper (print, or "Save as PDF" in the print dialog): letterhead, title, the
 * as-of date or period and every filter, then every row of the view with its totals. Only
 * `.print-area` prints (globals.css). The letterhead is a div: the print CSS hides <header>.
 */
export default function DebtorReportPrintLayout({ q, data, lines }: { q: DebtorQuery; data: PrintData; lines: [string, string][] }) {
  const { t, locale } = useI18n();
  const company = useCompanyProfile();
  const fmt = (kind: SheetColumn<unknown>["kind"], v: string | number | null): string => {
    if (v === null || v === "") return "";
    if (kind === "money") return formatMoney(Number(v), locale, { currency: null, decimals: 2 });
    if (kind === "percent") return `${formatMoney(Number(v), locale, { currency: null, decimals: 1 })} %`;
    if (kind === "number") return formatMoney(Number(v), locale, { currency: null, decimals: Number.isInteger(Number(v)) ? 0 : 1 });
    if (kind === "date") return formatGridDate(String(v));
    return String(v);
  };
  const table =
    data.kind === "turnover"
      ? {
          columns: turnoverColumns(t) as SheetColumn<unknown>[],
          rows: data.report.rows as unknown[],
          totals: { 1: data.report.totals.opening, 2: data.report.totals.debit, 3: data.report.totals.credit, 4: data.report.totals.closing, 5: data.report.totals.dso, 6: data.report.totals.dpo } as Record<number, number | null>,
        }
      : {
          columns: balanceColumns(t, q.tab) as SheetColumn<unknown>[],
          rows: data.report.rows as unknown[],
          totals: { 2: data.report.totals.balance, 3: data.report.totals.overdue, 5: data.report.totals.openCount } as Record<number, number | null>,
        };
  const right = (kind: string) => kind !== "text";

  return (
    <div className="print-area hidden bg-white text-slate-900 print:block">
      <div className="mx-auto text-[10px] leading-snug">
        <div className="mb-3 border-b border-slate-300 pb-2">
          <p className="text-[13px] font-bold">{company.legalName}</p>
          {company.profile.voen ? <p>VÖEN: {company.profile.voen}</p> : null}
        </div>
        <h1 className="mb-1 text-[15px] font-bold">{t("nav.items.debtorReports")}</h1>
        <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3">
          {lines.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-slate-500">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b-2 border-slate-300 bg-slate-100">
              {table.columns.map((c) => (
                <th key={c.header} className={`p-1 ${right(c.kind) ? "text-right" : "text-left"}`}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i} className="border-b border-slate-200 [break-inside:avoid]">
                {table.columns.map((c) => (
                  <td key={c.header} className={`p-1 ${right(c.kind) ? "text-right tabular-nums" : ""}`}>
                    {fmt(c.kind, c.value(r))}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t-2 border-slate-300 font-semibold">
              {table.columns.map((c, i) => (
                <td key={c.header} className={`p-1 ${right(c.kind) ? "text-right tabular-nums" : ""}`}>
                  {i === 0 ? t("debtorReports.totals") : table.totals[i] !== undefined ? fmt(c.kind, table.totals[i]) : ""}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
        <p className="mt-3 text-slate-500">{t("debtorReports.printedOn", { date: formatGridDate(new Date().toISOString().slice(0, 10)) })}</p>
      </div>
    </div>
  );
}
