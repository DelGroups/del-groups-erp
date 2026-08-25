"use client";

import React from "react";
import type { RecentActivityRow } from "@/types/database.types";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

interface RecentTransactionsTableProps {
  rows: RecentActivityRow[];
}

export default function RecentTransactionsTable({ rows }: RecentTransactionsTableProps) {
  const { t } = useI18n();

  return (
    <div className="app-card app-card-elevated">
      <div className="border-b border-app px-5 py-4">
        <h3 className="text-sm font-bold text-app">{t("dashboard.recentActivity")}</h3>
        <p className="text-[11px] text-app-muted">{t("dashboard.recentActivitySubtitle")}</p>
      </div>

      {rows.length === 0 ? (
        <div className="px-5 py-10 text-center text-xs text-app-muted">{t("dashboard.noTransactions")}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-app-card-hover font-bold uppercase text-app-muted">
              <tr>
                <th className="px-4 py-2.5">{t("common.date")}</th>
                <th className="px-4 py-2.5">{t("common.type")}</th>
                <th className="px-4 py-2.5">{t("dashboard.docOrCategory")}</th>
                <th className="px-4 py-2.5">{t("dashboard.party")}</th>
                <th className="px-4 py-2.5 text-right">{t("common.amount")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-app">
              {rows.map((row) => {
                const isIn = row.direction === "in";
                return (
                  <tr key={row.id} className="hover:bg-app-card-hover">
                    <td className="px-4 py-2.5">{row.date || "-"}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
                          isIn ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                        }`}
                      >
                        {isIn ? (
                          <ArrowUpRight className="h-3 w-3" />
                        ) : (
                          <ArrowDownRight className="h-3 w-3" />
                        )}
                        {row.type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-app-muted">{row.reference}</td>
                    <td className="px-4 py-2.5">{row.party}</td>
                    <td
                      className={`px-4 py-2.5 text-right font-mono font-bold ${
                        isIn ? "text-emerald-600" : "text-rose-600"
                      }`}
                    >
                      {isIn ? "+" : "-"}
                      {row.amount.toFixed(2)} {t("common.currency")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
