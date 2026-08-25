"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import DocumentListSearchBar from "@/components/documents/DocumentListSearchBar";
import WarehouseSlipPrintTemplate, {
  warehouseSlipToPrintData,
  type WarehouseSlipPrintData,
} from "@/components/warehouse/WarehouseSlipPrintTemplate";
import {
  approveWarehouseSlipAction,
  fetchWarehouseSlipsAction,
  rejectWarehouseSlipAction,
} from "@/lib/actions/warehouseSlips";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { useDocumentPrint } from "@/hooks/useDocumentPrint";
import type { WarehouseSlip, WarehouseSlipStatus } from "@/types/database.types";
import { CheckCircle2, ClipboardList, Printer, XCircle } from "lucide-react";

type TabFilter = "pending" | "approved" | "rejected" | "all";

export default function WarehouseSlipsPage() {
  const { can, ready } = useAuth();
  const { t, formatDateTime } = useI18n();
  const canApprove = can("can_approve_warehouse_slips");

  const [slips, setSlips] = useState<WarehouseSlip[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [tab, setTab] = useState<TabFilter>("all");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const { printData, setPrintData } = useDocumentPrint<WarehouseSlipPrintData>();

  const loadSlips = useCallback(async (currentTab: TabFilter) => {
    setLoading(true);
    setLoadError(null);
    const statusFilter: WarehouseSlipStatus | undefined =
      currentTab === "all" ? undefined : currentTab;
    const result = await fetchWarehouseSlipsAction(statusFilter);
    if (result.success) {
      setSlips(result.slips);
    } else {
      setSlips([]);
      setLoadError(result.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!ready) return;
    void loadSlips(tab);
  }, [ready, tab, loadSlips]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return slips;
    return slips.filter((slip) =>
      [
        slip.slip_number,
        slip.source_document_no,
        slip.warehouse_name,
        t(`warehouseSlips.types.${slip.type}`),
      ]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(q))
    );
  }, [slips, searchTerm, t]);

  const handleApproveAndPrint = async (slip: WarehouseSlip) => {
    if (!canApprove) {
      alert(t("warehouseSlips.noApprovePermission"));
      return;
    }
    setProcessingId(slip.id);
    const result = await approveWarehouseSlipAction(slip.id);
    setProcessingId(null);

    if (!result.success) {
      alert(t("common.error") + ": " + result.error);
      return;
    }

    await loadSlips(tab);
    setPrintData(warehouseSlipToPrintData(result.slip));
  };

  const handleReject = async (slip: WarehouseSlip) => {
    if (!canApprove) return;
    if (!confirm(t("warehouseSlips.rejectConfirm", { slipNo: slip.slip_number }))) return;

    setProcessingId(slip.id);
    const result = await rejectWarehouseSlipAction(slip.id);
    setProcessingId(null);

    if (!result.success) {
      alert(t("common.error") + ": " + result.error);
      return;
    }
    await loadSlips(tab);
  };

  const tabs: { id: TabFilter; label: string }[] = [
    { id: "pending", label: t("warehouseSlips.tabs.pending") },
    { id: "approved", label: t("warehouseSlips.tabs.approved") },
    { id: "rejected", label: t("warehouseSlips.tabs.rejected") },
    { id: "all", label: t("warehouseSlips.tabs.all") },
  ];

  return (
    <PageLayout>
      <DocumentPageHeader
        icon={<ClipboardList className="h-6 w-6 text-indigo-600" />}
        title={t("warehouseSlips.title")}
        description={t("warehouseSlips.description")}
      />

      <main className="flex-1 space-y-4 overflow-y-auto p-6">
        <div className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                tab === t.id
                  ? "bg-indigo-600 text-white"
                  : "app-card text-app-muted hover:bg-app-card-hover"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <DocumentListSearchBar
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder={t("warehouseSlips.searchPlaceholder")}
          onRefresh={() => void loadSlips(tab)}
          loading={loading}
        />

        {loadError && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
            {loadError}
          </div>
        )}

        <div className="app-table-wrap">
          {loading ? (
            <div className="p-12 text-center text-xs text-app-muted">{t("common.loading")}</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-xs text-app-muted">
              {tab === "pending"
                ? t("warehouseSlips.emptyPending")
                : t("warehouseSlips.empty")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-app bg-app-card-hover font-bold uppercase text-app">
                  <tr>
                    <th className="px-4 py-3">{t("warehouseSlips.slipNo")}</th>
                    <th className="px-4 py-3">{t("warehouseSlips.type")}</th>
                    <th className="px-4 py-3">{t("warehouseSlips.invoiceNo")}</th>
                    <th className="px-4 py-3">{t("warehouseSlips.warehouse")}</th>
                    <th className="px-4 py-3">{t("warehouseSlips.invoiceDate")}</th>
                    <th className="px-4 py-3">{t("common.status")}</th>
                    <th className="px-4 py-3 text-center">{t("common.actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-app">
                  {filtered.map((slip) => (
                    <tr key={slip.id} className="hover:bg-app-card-hover">
                      <td className="px-4 py-3 font-mono font-bold">{slip.slip_number}</td>
                      <td className="px-4 py-3">{t(`warehouseSlips.types.${slip.type}`)}</td>
                      <td className="px-4 py-3 font-mono">{slip.source_document_no || "-"}</td>
                      <td className="px-4 py-3">{slip.warehouse_name || "-"}</td>
                      <td className="px-4 py-3">{formatDateTime(slip.created_at)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            slip.status === "pending"
                              ? "bg-amber-100 text-amber-800"
                              : slip.status === "approved"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-rose-100 text-rose-800"
                          }`}
                        >
                          {t(`warehouseSlips.statuses.${slip.status}`)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          {slip.status === "pending" && canApprove && (
                            <>
                              <button
                                type="button"
                                title={t("warehouseSlips.approveAndPrint")}
                                disabled={processingId === slip.id}
                                onClick={() => void handleApproveAndPrint(slip)}
                                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[10px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                {t("warehouseSlips.approveAndPrint")}
                              </button>
                              <button
                                type="button"
                                title={t("warehouseSlips.reject")}
                                disabled={processingId === slip.id}
                                onClick={() => void handleReject(slip)}
                                className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                              >
                                <XCircle className="h-4 w-4" />
                              </button>
                            </>
                          )}
                          {slip.status === "approved" && (
                            <button
                              type="button"
                              title={t("warehouseSlips.reprint")}
                              onClick={() => setPrintData(warehouseSlipToPrintData(slip))}
                              className="rounded-lg p-1.5 text-indigo-600 hover:bg-indigo-50"
                            >
                              <Printer className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {printData && (
        <div className="print-area">
          <WarehouseSlipPrintTemplate slip={printData} />
        </div>
      )}
    </PageLayout>
  );
}
