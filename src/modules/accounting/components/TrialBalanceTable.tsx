"use client";

import type { TrialBalanceReport } from "@/lib/reports/trialBalance";
import { formatReportMoney } from "@/lib/reports/formatMoney";
import { useI18n } from "@/i18n/I18nProvider";
import { useUiStandard } from "@/design-system/components";
import { StandardGrid, type StandardColumn } from "@/components/lists/StandardGrid";
import { formatMoney } from "@/lib/dates/localeDate";

type TrialBalanceTableProps = {
  data: TrialBalanceReport;
  loading?: boolean;
};

type Row = TrialBalanceReport["rows"][number];
type AmountKey = "initialDebit" | "initialCredit" | "periodDebit" | "periodCredit" | "closingDebit" | "closingCredit";
const AMOUNTS: readonly [AmountKey, string][] = [
  ["initialDebit", "osv.colInitialDebit"],
  ["initialCredit", "osv.colInitialCredit"],
  ["periodDebit", "osv.colPeriodDebit"],
  ["periodCredit", "osv.colPeriodCredit"],
  ["closingDebit", "osv.colClosingDebit"],
  ["closingCredit", "osv.colClosingCredit"],
];

export default function TrialBalanceTable({ data, loading }: TrialBalanceTableProps) {
  const { t, locale } = useI18n();
  // UI_STANDARD (UI-6): the trial balance on the grid with its totals row; old table with the flag off.
  const standard = useUiStandard();

  if (standard) {
    const money = (v: number) => (v === 0 ? "—" : formatMoney(v, locale));
    const columns: StandardColumn<Row>[] = [
      { key: "code", header: t("osv.colCode"), type: "code", cell: (r) => <span className="ds-mono">{r.code}</span>, sortValue: (r) => r.code },
      { key: "name", header: t("osv.colAccount"), cell: (r) => r.name, sortValue: (r) => r.name },
      ...AMOUNTS.map<StandardColumn<Row>>(([key, label]) => ({ key, header: t(label), type: "money", cell: (r) => money(r[key]), sortValue: (r) => r[key] })),
    ];
    return (
      <StandardGrid<Row>
        id="accounting-trial-balance"
        label={t("osv.pageTitle")}
        columns={columns}
        rows={data.rows}
        rowKey={(r) => r.accountId || r.code}
        loading={loading}
        empty={t("osv.empty")}
        totals={Object.fromEntries([["code", t("osv.total")], ...AMOUNTS.map(([key]) => [key, money(data.totals[key])])])}
      />
    );
  }

  return (
    <div className="app-card overflow-hidden print:border print:border-slate-300">
      <table className="w-full text-left text-xs">
        <thead className="bg-app-card-hover font-bold uppercase text-app-muted print:bg-slate-100">
          <tr>
            <th className="p-2">{t("osv.colCode")}</th>
            <th className="p-2">{t("osv.colAccount")}</th>
            <th className="p-2 text-right">{t("osv.colInitialDebit")}</th>
            <th className="p-2 text-right">{t("osv.colInitialCredit")}</th>
            <th className="p-2 text-right">{t("osv.colPeriodDebit")}</th>
            <th className="p-2 text-right">{t("osv.colPeriodCredit")}</th>
            <th className="p-2 text-right">{t("osv.colClosingDebit")}</th>
            <th className="p-2 text-right">{t("osv.colClosingCredit")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-app">
          {loading ? (
            <tr>
              <td colSpan={8} className="p-6 text-center text-app-muted">{t("common.loading")}</td>
            </tr>
          ) : data.rows.length === 0 ? (
            <tr>
              <td colSpan={8} className="p-6 text-center text-app-muted">{t("osv.empty")}</td>
            </tr>
          ) : (
            data.rows.map((row) => (
              <tr key={row.accountId || row.code} className="hover:bg-app-card-hover/60">
                <td className="p-2 font-mono">{row.code}</td>
                <td className="p-2">{row.name}</td>
                <td className="p-2 text-right font-mono tabular-nums">{formatReportMoney(row.initialDebit)}</td>
                <td className="p-2 text-right font-mono tabular-nums">{formatReportMoney(row.initialCredit)}</td>
                <td className="p-2 text-right font-mono tabular-nums">{formatReportMoney(row.periodDebit)}</td>
                <td className="p-2 text-right font-mono tabular-nums">{formatReportMoney(row.periodCredit)}</td>
                <td className="p-2 text-right font-mono tabular-nums">{formatReportMoney(row.closingDebit)}</td>
                <td className="p-2 text-right font-mono tabular-nums">{formatReportMoney(row.closingCredit)}</td>
              </tr>
            ))
          )}
        </tbody>
        {!loading && data.rows.length > 0 ? (
          <tfoot className="border-t-2 border-app font-bold print:bg-slate-50">
            <tr>
              <td className="p-2" colSpan={2}>{t("osv.total")}</td>
              <td className="p-2 text-right font-mono tabular-nums">{formatReportMoney(data.totals.initialDebit)}</td>
              <td className="p-2 text-right font-mono tabular-nums">{formatReportMoney(data.totals.initialCredit)}</td>
              <td className="p-2 text-right font-mono tabular-nums">{formatReportMoney(data.totals.periodDebit)}</td>
              <td className="p-2 text-right font-mono tabular-nums">{formatReportMoney(data.totals.periodCredit)}</td>
              <td className="p-2 text-right font-mono tabular-nums">{formatReportMoney(data.totals.closingDebit)}</td>
              <td className="p-2 text-right font-mono tabular-nums">{formatReportMoney(data.totals.closingCredit)}</td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
