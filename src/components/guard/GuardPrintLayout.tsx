"use client";

import { useI18n } from "@/i18n/I18nProvider";
import { useCompanyProfile } from "@/hooks/useCompanyProfile";
import { formatGridDate, formatGridDateTime, formatMoney } from "@/lib/dates/localeDate";
import { findingColumns } from "@/lib/guard/export";
import type { GuardFinding, GuardReport } from "@/lib/guard/findings";
import { ReportBody } from "./ReportBody";

/** The letterhead of every printed guard page: the company, then the title. Only `.print-area` prints (globals.css). */
function Letterhead({ title }: { title: string }) {
  const company = useCompanyProfile();
  return (
    <>
      <div className="mb-3 border-b border-slate-300 pb-2">
        <p className="text-[13px] font-bold">{company.legalName}</p>
        {company.profile.voen ? <p>VÖEN: {company.profile.voen}</p> : null}
      </div>
      <h1 className="mb-1 text-[15px] font-bold">{title}</h1>
    </>
  );
}

/**
 * The findings on paper (print, or "Save as PDF" in the print dialog): the title, every filter,
 * then every finding of the filtered list in the same columns as the Excel file.
 */
export function FindingsPrint({ findings, lines }: { findings: readonly GuardFinding[]; lines: [string, string][] }) {
  const { t, locale } = useI18n();
  const columns = findingColumns(t);
  const cell = (kind: string, v: string | number | null): string => {
    if (v === null || v === "") return "";
    if (kind === "money") return formatMoney(Number(v), locale, { currency: null, decimals: 2 });
    if (kind === "date") return formatGridDate(String(v));
    return String(v);
  };
  return (
    <div className="print-area hidden bg-white text-slate-900 print:block">
      <div className="mx-auto text-[10px] leading-snug">
        <Letterhead title={t("guard.ui.printTitle")} />
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
              {columns.map((c) => (
                <th key={c.header} className={`p-1 ${c.kind === "money" ? "text-right" : "text-left"}`}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {findings.map((f) => (
              <tr key={f.id} className="border-b border-slate-200 [break-inside:avoid]">
                {columns.map((c) => (
                  <td key={c.header} className={`p-1 ${c.kind === "money" ? "text-right tabular-nums" : ""}`}>
                    {cell(c.kind, c.value(f))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-slate-500">{t("guard.ui.printedOn", { date: formatGridDate(new Date().toISOString().slice(0, 10)) })}</p>
      </div>
    </div>
  );
}

/** A saved report on paper: its title, the date, the author, then its text. */
export function ReportPrint({ report }: { report: GuardReport }) {
  const { t } = useI18n();
  return (
    <div className="print-area hidden bg-white text-slate-900 print:block">
      <div className="mx-auto text-[11px] leading-snug">
        <Letterhead title={report.title} />
        <p className="mb-3 text-slate-500">
          {t(`guard.kind.${report.kind}`)} · {formatGridDateTime(report.createdAt)} · {t(`guard.by.${report.createdByType}`)}
        </p>
        <ReportBody body={report.body} />
      </div>
    </div>
  );
}
