"use client";

import React from "react";
import type { FinancialReportData } from "@/types/database.types";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

interface FinancialReportViewProps {
  data: FinancialReportData;
  loading?: boolean;
}

export default function FinancialReportView({ data, loading }: FinancialReportViewProps) {
  const { ledger, summary } = data;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-[10px] font-bold uppercase text-emerald-700">Ümumi mədaxil</p>
          <p className="mt-1 font-mono text-xl font-bold text-emerald-700">
            {loading ? "..." : `${summary.totalIncome.toFixed(2)} AZN`}
          </p>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-[10px] font-bold uppercase text-rose-700">Ümumi məxaric</p>
          <p className="mt-1 font-mono text-xl font-bold text-rose-700">
            {loading ? "..." : `${summary.totalExpense.toFixed(2)} AZN`}
          </p>
        </div>
        <div className="rounded-xl border border-app bg-slate-900 p-4 text-white">
          <p className="text-[10px] font-bold uppercase opacity-70">Net axın</p>
          <p className="mt-1 font-mono text-xl font-bold">
            {loading ? "..." : `${summary.netFlow.toFixed(2)} AZN`}
          </p>
        </div>
      </div>

      {summary.byCategory.length > 0 && (
        <div className="app-table-wrap">
          <div className="border-b border-app px-5 py-4">
            <h3 className="text-sm font-bold text-app">Kateqoriya üzrə yekun</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-app-card-hover font-bold uppercase text-app-muted">
                <tr>
                  <th className="px-4 py-3">Növ</th>
                  <th className="px-4 py-3">Kateqoriya</th>
                  <th className="px-4 py-3 text-right">Cəmi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {summary.byCategory.map((row) => {
                  const isIncome = row.type === "Mədaxil";
                  return (
                    <tr key={`${row.type}-${row.category}`} className="hover:bg-app-card-hover">
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
                            isIncome
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-rose-50 text-rose-700"
                          }`}
                        >
                          {isIncome ? (
                            <ArrowUpRight className="h-3 w-3" />
                          ) : (
                            <ArrowDownRight className="h-3 w-3" />
                          )}
                          {row.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold">{row.category}</td>
                      <td
                        className={`px-4 py-3 text-right font-mono font-bold ${
                          isIncome ? "text-emerald-600" : "text-rose-600"
                        }`}
                      >
                        {row.total.toFixed(2)} AZN
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="app-table-wrap">
        <div className="border-b border-app px-5 py-4">
          <h3 className="text-sm font-bold text-app">Maliyyə jurnalı</h3>
          <p className="text-[11px] text-app-muted">Bütün mədaxil və məxaric əməliyyatları</p>
        </div>

        {ledger.length === 0 ? (
          <div className="px-5 py-12 text-center text-xs text-app-muted">
            Seçilmiş dövr üzrə əməliyyat tapılmadı.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-app-card-hover font-bold uppercase text-app-muted">
                <tr>
                  <th className="px-4 py-3">Tarix</th>
                  <th className="px-4 py-3">Növ</th>
                  <th className="px-4 py-3">Kateqoriya</th>
                  <th className="px-4 py-3">Hesab</th>
                  <th className="px-4 py-3">Qeyd</th>
                  <th className="px-4 py-3 text-right">Məbləğ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-app">
                {ledger.map((row) => {
                  const isIn = row.direction === "in";
                  return (
                    <tr key={row.id} className="hover:bg-app-card-hover">
                      <td className="px-4 py-3">{row.date}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
                            isIn ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                          }`}
                        >
                          {row.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold">{row.category}</td>
                      <td className="px-4 py-3">{row.account_name}</td>
                      <td className="max-w-xs truncate px-4 py-3 text-app-muted">
                        {row.notes || "-"}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono font-bold ${
                          isIn ? "text-emerald-600" : "text-rose-600"
                        }`}
                      >
                        {isIn ? "+" : "-"}
                        {row.amount.toFixed(2)} AZN
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-app bg-app-card-hover font-bold">
                <tr>
                  <td className="px-4 py-3" colSpan={5}>
                    YEKUN (Mədaxil − Məxaric)
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono ${
                      summary.netFlow >= 0 ? "text-emerald-700" : "text-rose-700"
                    }`}
                  >
                    {summary.netFlow.toFixed(2)} AZN
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
