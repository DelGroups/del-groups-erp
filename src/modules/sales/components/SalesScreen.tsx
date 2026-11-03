"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Ban, Banknote, BarChart3, FileCode2, FileJson, PencilLine, Plus, Printer, Truck } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { invalidateModel, useFilterContext, useFormatter, useViewData, ViewEngine, ViewScope, type RowActionSpec, type ViewRecord } from "@/views";
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
        rowActions={(r) => salesRowActions(r, t, can)}
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

/**
 * The row "…" menu of the invoice list (UI-5): the same actions as the classic list and the
 * invoice form (SaleFormScreen), shown as the row's status allows; the form runs them (?do=).
 */
function salesRowActions(r: ViewRecord, t: (key: string) => string, can: ReturnType<typeof useAuth>["can"]): RowActionSpec[] {
  const status = String(r.doc_status ?? "");
  const icon = (C: typeof Printer) => <C className="h-4 w-4" />;
  return [
    { key: "edit", label: t("sales.engine.actions.editDraft"), icon: icon(PencilLine), hidden: !(status === "draft" && can("can_edit_sales")) },
    { key: "amend", label: t("invoice.amend.edit"), icon: icon(PencilLine), hidden: !(status === "posted" && can("can_edit_posted_sales")) },
    { key: "pay", label: t("sales.engine.actions.registerPayment"), icon: icon(Banknote), hidden: !(Number(r.remaining ?? 0) > 0) || status === "cancelled" },
    { key: "print", label: t("common.print"), icon: icon(Printer) },
    { key: "send", label: t("sales.engine.actions.sendToWarehouse"), icon: icon(Truck), hidden: !(status === "posted" && (r.warehouse_state === "not_sent" || r.warehouse_state === "rejected")) },
    { key: "xml", label: `${t("tax.eQaimeExport")} · ${t("taxPayrollSettings.formats.XML_ETAXES")}`, icon: icon(FileCode2), hidden: status === "cancelled" },
    { key: "json", label: `${t("tax.eQaimeExport")} · ${t("taxPayrollSettings.formats.JSON_STANDARD")}`, icon: icon(FileJson), hidden: status === "cancelled" },
    { key: "void", label: t("common.void"), icon: icon(Ban), destructive: true, hidden: !can("can_delete_sales") || status === "cancelled" },
  ];
}
