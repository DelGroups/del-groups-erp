"use client";

import type { TrialBalanceReport } from "@/lib/reports/trialBalance";
import { formatReportMoney } from "@/lib/reports/formatMoney";
import { useI18n } from "@/i18n/I18nProvider";

type TrialBalanceTableProps = {
  data: TrialBalanceReport;
  loading?: boolean;
};

export default function TrialBalanceTable({ data, loading }: TrialBalanceTableProps) {
  const { t } = useI18n();

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
