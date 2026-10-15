"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Settings } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { fetchEmployees } from "@/modules/hr";
import { EMPLOYEE_DEPARTMENTS } from "@/types/database.types";
import { EngineScreen, FormView, useFormatter, type FormAction } from "@/views";
import { fetchPendingCommissions } from "../lib/api";
import { commissionKpis, commissionsDefinition, commissionToRecord, type CommissionRecord } from "../views/commissions";

// Pending commissions with their seller's name and department, as the classic list shows them.
const DEFINITION = commissionsDefinition(
  {
    fetchAll: async () => {
      const [employees, pending] = await Promise.all([fetchEmployees(), fetchPendingCommissions()]);
      const byId = new Map(employees.map((e) => [e.id, { full_name: e.full_name, department: e.department }]));
      return pending.map((c) => commissionToRecord(c as unknown as Record<string, unknown>, byId)) as unknown as Record<string, unknown>[];
    },
  },
  EMPLOYEE_DEPARTMENTS.map((d) => ({ value: d.value, label: d.label }))
);

/** Pending sales commissions on the view engine (new UI). */
export default function CommissionsScreen() {
  const { t } = useI18n();
  const { can } = useAuth();
  return (
    <EngineScreen
      definition={DEFINITION}
      title={t("commissions.pageTitle")}
      kpis={(records, fmt, ctx) => commissionKpis(records, fmt, ctx.now)}
      actions={
        can("can_manage_commissions") ? (
          <Link href="/settings/commissions" className="ds-btn ds-btn-sm">
            <Settings className="h-4 w-4" aria-hidden />
            {t("commissions.rulesLink")}
          </Link>
        ) : null
      }
      recordTitle={(r) => r.sale_doc_no ?? r.seller_name ?? ""}
      renderRecord={(r) => <CommissionRecordView record={r} />}
    />
  );
}

function CommissionRecordView({ record }: { record: CommissionRecord }) {
  const { t } = useI18n();
  const fmt = useFormatter();
  const router = useRouter();
  const actions: FormAction[] = record.sale_id
    ? [{ key: "sale", label: t("commissions.engine.openSale"), primary: true, icon: <ExternalLink className="h-4 w-4" aria-hidden />, onClick: () => router.push(`/sales/${record.sale_id}`) }]
    : [];
  return <FormView definition={DEFINITION} record={record} canWrite={false} fmt={fmt} actions={actions} />;
}
