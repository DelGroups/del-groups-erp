"use client";

import React, { useMemo } from "react";
import type { Employee, PendingCommissionSummary, SalesCommission } from "@/types/database.types";
import { getDepartmentLabel } from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";

interface PendingCommissionsViewProps {
  employees: Employee[];
  commissions: SalesCommission[];
  loading?: boolean;
}

export default function PendingCommissionsView({
  employees,
  commissions,
  loading,
}: PendingCommissionsViewProps) {
  const { t } = useI18n();
  const summaries = useMemo(() => {
    const map = new Map<string, PendingCommissionSummary>();

    for (const emp of employees) {
      map.set(emp.id, {
        employee_id: emp.id,
        employee_name: emp.full_name,
        department: emp.department,
        pending_count: 0,
        pending_total: 0,
        commissions: [],
      });
    }

    for (const c of commissions) {
      const key = c.employee_id || c.seller_name || "unknown";
      let summary = c.employee_id ? map.get(c.employee_id) : undefined;

      if (!summary && c.seller_name) {
        summary = {
          employee_id: key,
          employee_name: c.seller_name,
          department: "general",
          pending_count: 0,
          pending_total: 0,
          commissions: [],
        };
        map.set(key, summary);
      }

      if (!summary) continue;
      summary.pending_count += 1;
      summary.pending_total += c.commission_amount;
      summary.commissions.push(c);
    }

    return Array.from(map.values())
      .filter((s) => s.pending_count > 0)
      .sort((a, b) => b.pending_total - a.pending_total);
  }, [employees, commissions]);

  if (loading) {
    return (
      <div className="app-card app-card-elevated p-12 text-center text-xs text-app-muted">
        {t("commissions.loadingCommissions")}
      </div>
    );
  }

  if (summaries.length === 0) {
    return (
      <div className="app-card app-card-elevated p-12 text-center">
        <p className="text-sm font-semibold text-app">{t("commissions.noPendingCommissions")}</p>
        <p className="mt-1 text-xs text-app-muted">{t("commissions.noPendingCommissionsHint")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {summaries.map((summary) => (
        <div
          key={summary.employee_id}
          className="app-table-wrap"
        >
          <div className="flex flex-col justify-between gap-3 border-b border-app app-toolbar px-5 py-4 md:flex-row md:items-center">
            <div>
              <h3 className="font-bold">{summary.employee_name}</h3>
              <p className="text-[11px] text-app-muted">
                {getDepartmentLabel(summary.department)} · {t("commissions.rowCount", { count: summary.pending_count })}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase text-app-muted">{t("commissions.pendingTotal")}</p>
              <p className="font-mono text-xl font-bold text-emerald-400">
                {summary.pending_total.toFixed(2)} {t("common.currency")}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-app-card-hover font-bold uppercase text-app-muted">
                <tr>
                  <th className="px-4 py-2.5">{t("commissions.invoiceCol")}</th>
                  <th className="px-4 py-2.5">{t("commissions.productCategoryCol")}</th>
                  <th className="px-4 py-2.5 text-right">{t("commissions.saleAmountCol")}</th>
                  <th className="px-4 py-2.5 text-right">{t("commissions.rateCol")}</th>
                  <th className="px-4 py-2.5 text-right">{t("commissions.commissionCol")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {summary.commissions.map((c) => (
                  <tr key={c.id} className="hover:bg-app-card-hover">
                    <td className="px-4 py-2.5 font-mono font-semibold text-app-accent">
                      {c.sale_doc_no || "-"}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-app">{c.product_name || "-"}</p>
                      <p className="text-[10px] text-app-muted">{c.product_category}</p>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">
                      {c.sale_amount.toFixed(2)} {t("common.currency")}
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold text-app-accent">
                      %{c.commission_rate.toFixed(1)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold text-emerald-600">
                      {c.commission_amount.toFixed(2)} {t("common.currency")}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-app bg-app-card-hover font-bold">
                <tr>
                  <td className="px-4 py-2.5" colSpan={4}>
                    {t("commissions.totalLabel")}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-emerald-700">
                    {summary.pending_total.toFixed(2)} {t("common.currency")}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
