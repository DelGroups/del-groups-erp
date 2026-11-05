"use client";

import React, { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { EmployeesPageTabProps } from "@/modules/hr";
import type { EmployeeAdvance } from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";
import { useUiStandard } from "@/design-system/components";
import { StandardGrid } from "@/components/lists/StandardGrid";
import { formatGridDate, formatMoney } from "@/lib/dates/localeDate";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import { fetchEmployeeAdvances } from "../lib/payrollRuns";
import { payEmployeeAdvanceAction } from "../actions/payroll";
import AdvanceFormModal from "./AdvanceFormModal";

/** "Advances" tab of the employees screen: salary advances and paying a new one. */
export default function AdvancesTab({
  employees,
  accounts,
  canManageHr,
  createOpen,
  setCreateOpen,
  showError,
  showSuccess,
}: EmployeesPageTabProps) {
  const { t, locale } = useI18n();
  // UI_STANDARD (UI-6): the advances on the grid; old table with the flag off.
  const standard = useUiStandard();
  const [advances, setAdvances] = useState<EmployeeAdvance[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void fetchEmployeeAdvances().then((adv) => {
      if (cancelled) return;
      setAdvances(adv);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const handlePayAdvance = async (payload: {
    employeeId: string;
    amount: number;
    accountId: string;
    description: string;
    requestDate: string;
  }) => {
    setSaving(true);
    const result = await payEmployeeAdvanceAction(payload);
    setSaving(false);
    if (!result.success) {
      showError(t("employees.errorPrefix") + formatRpcError(result.error, t));
      return;
    }
    showSuccess(t("employees.advance.success"));
    setCreateOpen(false);
    setLoading(true);
    setReloadKey((k) => k + 1);
  };

  return (
    <>
      <div className="app-table-wrap">
        {canManageHr && (
          <div className="flex justify-end border-b border-app px-4 py-3">
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-1 rounded-lg bg-[image:var(--app-gradient)] px-3 py-1.5 text-xs font-bold text-white"
            >
              <Plus className="h-4 w-4" />
              {t("employees.advance.newTitle")}
            </button>
          </div>
        )}
        {standard ? (
          <StandardGrid<EmployeeAdvance>
            id="payroll-advances"
            label={t("employees.tabs.advances")}
            rows={advances}
            rowKey={(adv) => adv.id}
            loading={loading}
            empty={t("employees.advance.empty")}
            columns={[
              { key: "employee", header: t("employees.employee"), className: "font-semibold", cell: (adv) => adv.employees?.full_name || "—", sortValue: (adv) => adv.employees?.full_name },
              { key: "date", header: t("employees.advance.requestDate"), type: "date", cell: (adv) => formatGridDate(adv.request_date), sortValue: (adv) => adv.request_date },
              { key: "amount", header: t("employees.advance.amount"), type: "money", className: "font-semibold", cell: (adv) => formatMoney(adv.amount, locale, { currency: t("common.currency") }), sortValue: (adv) => adv.amount },
              { key: "status", header: t("common.status"), type: "status", cell: (adv) => <AdvanceStatusBadge status={adv.status} t={t} />, sortValue: (adv) => adv.status },
              { key: "account", header: t("common.account"), cell: (adv) => adv.accounts?.name || "—", sortValue: (adv) => adv.accounts?.name },
              { key: "notes", header: t("common.notes"), className: "ds-muted", cell: (adv) => adv.description || "—" },
            ]}
          />
        ) : loading ? (
          <div className="p-12 text-center text-xs text-app-muted">{t("common.loading")}</div>
        ) : advances.length === 0 ? (
          <div className="p-12 text-center text-xs text-app-muted">{t("employees.advance.empty")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-app bg-app-card-hover font-bold uppercase text-app">
                <tr>
                  <th className="px-4 py-3">{t("employees.employee")}</th>
                  <th className="px-4 py-3">{t("employees.advance.requestDate")}</th>
                  <th className="px-4 py-3 text-right">{t("employees.advance.amount")}</th>
                  <th className="px-4 py-3">{t("common.status")}</th>
                  <th className="px-4 py-3">{t("common.account")}</th>
                  <th className="px-4 py-3">{t("common.notes")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {advances.map((adv) => (
                  <tr key={adv.id} className="hover:bg-app-card-hover">
                    <td className="px-4 py-3 font-semibold">{adv.employees?.full_name || "—"}</td>
                    <td className="px-4 py-3">{adv.request_date}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold">
                      {adv.amount.toFixed(2)} {t("common.currency")}
                    </td>
                    <td className="px-4 py-3">
                      <AdvanceStatusBadge status={adv.status} t={t} />
                    </td>
                    <td className="px-4 py-3">{adv.accounts?.name || "—"}</td>
                    <td className="px-4 py-3 text-app-muted">{adv.description || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AdvanceFormModal
        isOpen={createOpen}
        employees={employees}
        accounts={accounts}
        saving={saving}
        onClose={() => setCreateOpen(false)}
        onSubmit={handlePayAdvance}
      />
    </>
  );
}

function AdvanceStatusBadge({
  status,
  t,
}: {
  status: EmployeeAdvance["status"];
  t: (key: string) => string;
}) {
  const cls =
    status === "DEDUCTED"
      ? "bg-slate-100 text-slate-700"
      : status === "PAID"
        ? "bg-emerald-100 text-emerald-800"
        : "bg-amber-100 text-amber-800";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`}>
      {t(`employees.advance.status${status}`)}
    </span>
  );
}
