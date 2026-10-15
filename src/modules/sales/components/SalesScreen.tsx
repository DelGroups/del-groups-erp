"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { BarChart3, Plus } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { invalidateModel, useFilterContext, useFormatter, useViewData, ViewEngine, ViewScope } from "@/views";
import { SALES_VIEW_KEY } from "../views/sales";
import { SALES_DEFINITION } from "../hooks/useSalesDefinition";
import { SalesDashboard } from "./SalesDashboard";

/** Sales invoices on the view engine (new UI): dashboard, then list, kanban, pivot, graph, calendar. */
export default function SalesScreen() {
  return (
    <ViewScope>
      <SalesBody />
    </ViewScope>
  );
}

function SalesBody() {
  const { t } = useI18n();
  const { can } = useAuth();
  const fmt = useFormatter();
  const ctx = useFilterContext();
  const client = useQueryClient();
  const data = useViewData(SALES_DEFINITION);
  const [preset, setPreset] = useState<{ id: number; filters: string[] } | undefined>(undefined);

  // Invoices are saved in the invoice form; always show the latest when the list opens.
  useEffect(() => {
    void invalidateModel(client, SALES_VIEW_KEY);
  }, [client]);

  return (
    <div className="flex flex-col gap-5">
      {data.status === "ready" && data.records.length ? (
        <SalesDashboard records={data.records} fmt={fmt} onFilter={(filters) => setPreset((p) => ({ id: (p?.id ?? 0) + 1, filters }))} />
      ) : null}
      <ViewEngine
        data={data}
        title={t("sales.title")}
        fmt={fmt}
        ctx={ctx}
        preset={preset}
        openHref={(r) => `/sales/${r.id}`}
        actions={
          <>
            {can("can_view_reports") ? (
              <Link href="/reports/sales" className="ds-btn ds-btn-sm">
                <BarChart3 className="h-4 w-4" aria-hidden />
                {t("reports.salesReportTitle")}
              </Link>
            ) : null}
            {can("can_create_invoice") ? (
              <Link href="/sales/new" className="ds-btn ds-btn-sm ds-btn-primary">
                <Plus className="h-4 w-4" aria-hidden />
                {t("sales.createLabel")}
              </Link>
            ) : null}
          </>
        }
      />
    </div>
  );
}
