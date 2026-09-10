"use client";

import type {
  GlBalanceSheetSummary,
  GlFinancialReportsData,
  GlProfitAndLossSummary,
} from "@/lib/reports/glFinancialReports";
import { useI18n } from "@/i18n/I18nProvider";

type GlFinancialReportsDashboardProps = {
  data: GlFinancialReportsData;
  loading?: boolean;
};

function formatMoney(value: number, currency = "AZN"): string {
  return `${value.toFixed(2)} ${currency}`;
}

function BalanceList({
  title,
  rows,
  total,
  loading,
  totalLabel,
}: {
  title: string;
  rows: GlBalanceSheetSummary["assets"];
  total: number;
  loading?: boolean;
  totalLabel: string;
}) {
  return (
    <div className="app-card h-full p-4">
      <h3 className="mb-3 text-sm font-bold text-app">{title}</h3>
      <div className="space-y-2 text-xs">
        {loading ? (
          <p className="text-app-muted">...</p>
        ) : rows.length === 0 ? (
          <p className="text-app-muted">—</p>
        ) : (
          rows.map((row) => (
            <div key={`${row.code}-${row.name}`} className="flex items-center justify-between gap-2">
              <span className="text-app-muted">
                <span className="font-mono text-[10px]">{row.code}</span> {row.name}
              </span>
              <span className="font-mono font-semibold">{formatMoney(row.balance)}</span>
            </div>
          ))
        )}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-app pt-3 text-sm font-bold">
        <span>{totalLabel}</span>
        <span className="font-mono">{loading ? "..." : formatMoney(total)}</span>
      </div>
    </div>
  );
}

export default function GlFinancialReportsDashboard({
  data,
  loading,
}: GlFinancialReportsDashboardProps) {
  const { t } = useI18n();
  const pl: GlProfitAndLossSummary = data.profitAndLoss;
  const bs: GlBalanceSheetSummary = data.balanceSheet;
  const ledger = data.generalLedger;

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-3 text-sm font-bold text-app">{t("glReports.plTitle")}</h3>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="app-card p-4">
            <p className="text-[10px] font-bold uppercase text-app-muted">{t("glReports.revenue")}</p>
            <p className="mt-1 font-mono text-xl font-bold text-emerald-700">
              {loading ? "..." : formatMoney(pl.totalRevenue)}
            </p>
          </div>
          <div className="app-card p-4">
            <p className="text-[10px] font-bold uppercase text-app-muted">{t("glReports.cogs")}</p>
            <p className="mt-1 font-mono text-xl font-bold text-amber-700">
              {loading ? "..." : formatMoney(pl.totalCogs)}
            </p>
          </div>
          <div className="app-card p-4">
            <p className="text-[10px] font-bold uppercase text-app-muted">{t("glReports.grossProfit")}</p>
            <p className="mt-1 font-mono text-xl font-bold text-violet-700">
              {loading ? "..." : formatMoney(pl.grossProfit)}
            </p>
          </div>
          <div className="app-card p-4">
            <p className="text-[10px] font-bold uppercase text-app-muted">{t("glReports.netProfit")}</p>
            <p className="mt-1 font-mono text-xl font-bold text-app">
              {loading ? "..." : formatMoney(pl.netProfit)}
            </p>
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-bold text-app">{t("glReports.balanceSheetTitle")}</h3>
        <div className="grid gap-4 lg:grid-cols-2">
          <BalanceList
            title={t("glReports.assets")}
            rows={bs.assets}
            total={bs.totalAssets}
            loading={loading}
            totalLabel={t("glReports.total")}
          />
          <div className="space-y-4">
            <BalanceList
              title={t("glReports.liabilities")}
              rows={bs.liabilities}
              total={bs.totalLiabilities}
              loading={loading}
              totalLabel={t("glReports.total")}
            />
            <div className="app-card p-4">
              <h3 className="mb-3 text-sm font-bold text-app">{t("glReports.equity")}</h3>
              <div className="space-y-2 text-xs">
                {loading ? (
                  <p className="text-app-muted">...</p>
                ) : (
                  <>
                    {bs.equityAccounts.map((row) => (
                      <div key={`${row.code}-${row.name}`} className="flex justify-between gap-2">
                        <span className="text-app-muted">
                          <span className="font-mono text-[10px]">{row.code}</span> {row.name}
                        </span>
                        <span className="font-mono font-semibold">{formatMoney(row.balance)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between gap-2">
                      <span className="text-app-muted">{t("glReports.netIncomeYtd")}</span>
                      <span className="font-mono font-semibold">{formatMoney(bs.netIncomeYtd)}</span>
                    </div>
                  </>
                )}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-app pt-3 text-sm font-bold">
                <span>{t("glReports.totalEquity")}</span>
                <span className="font-mono">{loading ? "..." : formatMoney(bs.totalEquity)}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-bold text-app">{t("glReports.generalLedgerTitle")}</h3>
        <div className="app-card overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-app-card-hover font-bold uppercase text-app-muted">
              <tr>
                <th className="p-3">{t("common.date")}</th>
                <th className="p-3">{t("glReports.documentType")}</th>
                <th className="p-3">{t("glReports.account")}</th>
                <th className="p-3">{t("glReports.description")}</th>
                <th className="p-3 text-right">{t("glReports.debit")}</th>
                <th className="p-3 text-right">{t("glReports.credit")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-app">
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-app-muted">{t("common.loading")}</td>
                </tr>
              ) : ledger.rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-app-muted">{t("glReports.ledgerEmpty")}</td>
                </tr>
              ) : (
                ledger.rows.map((row) => (
                  <tr key={row.lineId} className="hover:bg-app-card-hover/60">
                    <td className="p-3">{row.entryDate}</td>
                    <td className="p-3">{row.documentType}</td>
                    <td className="p-3">
                      <span className="font-mono text-[10px] text-app-muted">{row.accountCode}</span>
                      <p>{row.accountName}</p>
                    </td>
                    <td className="p-3 text-app-muted">{row.description || "—"}</td>
                    <td className="p-3 text-right font-mono">
                      {row.debit > 0 ? formatMoney(row.debit) : "—"}
                    </td>
                    <td className="p-3 text-right font-mono">
                      {row.credit > 0 ? formatMoney(row.credit) : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && ledger.total > ledger.limit ? (
          <p className="mt-2 text-xs text-app-muted">
            {t("glReports.ledgerPagination", {
              from: String(ledger.offset + 1),
              to: String(Math.min(ledger.offset + ledger.limit, ledger.total)),
              total: String(ledger.total),
            })}
          </p>
        ) : null}
      </section>
    </div>
  );
}
