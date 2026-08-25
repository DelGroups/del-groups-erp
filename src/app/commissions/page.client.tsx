"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageLayout from "@/components/layout/PageLayout";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import PendingCommissionsView from "@/components/commissions/PendingCommissionsView";
import { fetchPendingCommissions } from "@/lib/commissions/api";
import { fetchEmployees } from "@/lib/hr/employees";
import type { Employee, SalesCommission } from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";
import { Percent, Settings } from "lucide-react";

export default function CommissionsPage() {
  const { t } = useI18n();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [commissions, setCommissions] = useState<SalesCommission[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [emps, pending] = await Promise.all([fetchEmployees(), fetchPendingCommissions()]);
    setEmployees(emps);
    setCommissions(pending);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const pendingTotal = commissions.reduce((s, c) => s + c.commission_amount, 0);

  return (
    <PageLayout>
        <DocumentPageHeader
          icon={<Percent className="h-6 w-6 text-app-accent" />}
          title={t("commissions.pageTitle")}
          description={t("commissions.pageDescription")}
          createLabel={t("common.refresh")}
          onCreate={() => void loadData()}
          extraActions={
            <Link
              href="/settings/commissions"
              className="flex items-center gap-1.5 rounded-xl border border-app px-4 py-2.5 text-xs font-semibold text-app hover:bg-app-card-hover"
            >
              <Settings className="h-4 w-4" />
              {t("commissions.rulesLink")}
            </Link>
          }
        />

        <main className="flex-1 space-y-4 overflow-y-auto p-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="app-card app-card-elevated p-4">
              <p className="text-[10px] font-bold uppercase text-app-muted">{t("commissions.pendingRows")}</p>
              <p className="mt-1 text-2xl font-bold text-app">{commissions.length}</p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
              <p className="text-[10px] font-bold uppercase text-emerald-700">{t("commissions.pendingTotal")}</p>
              <p className="mt-1 font-mono text-2xl font-bold text-emerald-700">
                {pendingTotal.toFixed(2)} AZN
              </p>
            </div>
            <div className="rounded-2xl border border-[color:var(--app-accent-ring)] bg-[color:var(--app-accent-soft)] p-4 shadow-sm">
              <p className="text-[10px] font-bold uppercase text-app-accent">{t("commissions.sellerCount")}</p>
              <p className="mt-1 text-2xl font-bold text-app-accent">
                {new Set(commissions.map((c) => c.employee_id || c.seller_name)).size}
              </p>
            </div>
          </div>

          <PendingCommissionsView
            employees={employees}
            commissions={commissions}
            loading={loading}
          />
        </main>
      </PageLayout>
  );
}
