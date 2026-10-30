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
} from "../actions/warehouseSlips";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { useDocumentPrint } from "@/hooks/useDocumentPrint";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import ToastMessage from "@/components/ui/ToastMessage";
import Button from "@/components/ui/button";
import Card from "@/components/ui/card";
import StatusBadge from "@/components/ui/status-badge";
import { Table, TableWrap, THead, Th, Td } from "@/components/ui/table";
import { useToast } from "@/hooks/useToast";
import type { WarehouseSlip, WarehouseSlipStatus } from "@/types/database.types";
import { CheckCircle2, ClipboardList, FileSpreadsheet, Printer, XCircle } from "lucide-react";
import { ListBodyCells, ListHeadCells, dash, useTableColumns, type TableColumn } from "@/components/lists/listTable";
import { useProfileNames } from "@/components/lists/useProfileNames";
import { exportXlsx, xlsxFileName } from "@/lib/export/exportXlsx";
import { profileName } from "@/lib/profiles/displayNames";

/** Column choice key of this list (prompt 24c). */
const SLIPS_LIST_KEY = "inventory.slips";

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
  const { message: toastMessage, variant: toastVariant, showError } = useToast();

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

  // Columns of the list (prompt 24c): a slip is dated when it is created; no salesperson.
  const names = useProfileNames(useMemo(() => slips.map((s) => s.created_by), [slips]));
  const columnDefs = useMemo<TableColumn<WarehouseSlip>[]>(
    () => [
      { key: "slip_number", labelKey: "warehouseSlips.slipNo", defaultVisible: true, required: true, tdClassName: "font-mono font-bold", cell: (s) => s.slip_number },
      { key: "type", labelKey: "warehouseSlips.type", defaultVisible: true, cell: (s) => t(`warehouseSlips.types.${s.type}`) },
      { key: "source", labelKey: "warehouseSlips.invoiceNo", defaultVisible: true, tdClassName: "font-mono", cell: (s) => s.source_document_no || "-" },
      { key: "warehouse", labelKey: "warehouseSlips.warehouse", defaultVisible: true, cell: (s) => s.warehouse_name || "-" },
      { key: "created_at", labelKey: "listColumns.issuedAt", offLabelKey: "warehouseSlips.invoiceDate", defaultVisible: true, exportType: "datetime", exportValue: (s) => s.created_at, cell: (s) => formatDateTime(s.created_at) },
      {
        key: "status",
        labelKey: "common.status",
        defaultVisible: true,
        exportValue: (s) => t(`warehouseSlips.statuses.${s.status}`),
        cell: (s) => (
          <StatusBadge tone={s.status === "pending" ? "draft" : s.status === "approved" ? "posted" : "cancelled"}>
            {t(`warehouseSlips.statuses.${s.status}`)}
          </StatusBadge>
        ),
      },
      { key: "created_by", labelKey: "listColumns.createdBy", defaultVisible: true, standard: true, cell: (s) => dash(profileName(names, s.created_by)) },
      { key: "delivery_due_at", labelKey: "inventory.engine.deliveryDue", defaultVisible: false, exportType: "datetime", exportValue: (s) => s.delivery_due_at, cell: (s) => (s.delivery_due_at ? formatDateTime(s.delivery_due_at) : "—") },
      { key: "approved_at", labelKey: "inventory.engine.approvedAt", defaultVisible: false, exportType: "datetime", exportValue: (s) => s.approved_at, cell: (s) => (s.approved_at ? formatDateTime(s.approved_at) : "—") },
      { key: "item_count", labelKey: "inventory.engine.lines", defaultVisible: false, numeric: true, exportType: "integer", exportValue: (s) => s.items.length, cell: (s) => s.items.length },
      { key: "notes", labelKey: "inventoryCount.notes", defaultVisible: false, tdClassName: "max-w-xs truncate", cell: (s) => dash(s.notes) },
    ],
    [t, formatDateTime, names]
  );
  const columns = useTableColumns(SLIPS_LIST_KEY, columnDefs);
  const handleExport = () => {
    if (!filtered.length) return;
    void exportXlsx(xlsxFileName(t("warehouseSlips.title"), new Date()), { sheetName: t("warehouseSlips.title"), columns: columns.exportColumns, rows: filtered });
  };

  const handleApproveAndPrint = async (slip: WarehouseSlip) => {
    if (!canApprove) {
      showError(t("warehouseSlips.noApprovePermission"));
      return;
    }
    setProcessingId(slip.id);
    const result = await approveWarehouseSlipAction(slip.id);
    setProcessingId(null);

    if (!result.success) {
      showError(`${t("common.error")}: ${formatRpcError(result.error, t)}`);
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
      showError(`${t("common.error")}: ${formatRpcError(result.error, t)}`);
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
        extraActions={
          // Excel comes with LIST_COLUMNS (prompt 24c): this list had no export.
          columns.enabled ? (
            <Button type="button" variant="secondary" onClick={handleExport}>
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              {t("common.excelDownload")}
            </Button>
          ) : undefined
        }
      />

      <main className="app-page-content flex-1 space-y-3 overflow-y-auto md:space-y-4">
        <div className="flex flex-wrap gap-2">
          {tabs.map((item) => (
            <Button
              key={item.id}
              type="button"
              variant={tab === item.id ? "primary" : "outline"}
              size="sm"
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </Button>
          ))}
        </div>

        <DocumentListSearchBar
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder={t("warehouseSlips.searchPlaceholder")}
          onRefresh={() => void loadSlips(tab)}
          loading={loading}
        />
        {columns.picker ? <div className="flex justify-end">{columns.picker}</div> : null}

        {loadError && (
          <div className="rounded-xl alert-danger rounded-xl px-4 py-3 text-xs">
            {loadError}
          </div>
        )}

        <Card padding={false}>
          {loading ? (
            <div className="p-12 text-center text-xs text-app-muted">{t("common.loading")}</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-xs text-app-muted">
              {tab === "pending"
                ? t("warehouseSlips.emptyPending")
                : t("warehouseSlips.empty")}
            </div>
          ) : (
            <TableWrap>
              <div className="overflow-x-auto">
                <Table>
                  <THead>
                    <tr>
                      <ListHeadCells columns={columns.visible} />
                      <Th className="text-center">{t("common.actions")}</Th>
                    </tr>
                  </THead>
                  <tbody className="divide-y divide-slate-100 text-app">
                    {filtered.map((slip) => {
                      return (
                        <tr key={slip.id} className="hover:bg-app-card-hover">
                          <ListBodyCells columns={columns.visible} row={slip} />
                          <Td>
                            <div className="flex items-center justify-center gap-1">
                              {slip.status === "pending" && canApprove && (
                                <>
                                  <Button
                                    type="button"
                                    size="sm"
                                    title={t("warehouseSlips.approveAndPrint")}
                                    loading={processingId === slip.id}
                                    onClick={() => void handleApproveAndPrint(slip)}
                                    className="bg-emerald-600 bg-none text-white hover:bg-emerald-700 hover:brightness-100"
                                  >
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    {t("warehouseSlips.approveAndPrint")}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    title={t("warehouseSlips.reject")}
                                    disabled={processingId === slip.id}
                                    onClick={() => void handleReject(slip)}
                                    className="text-rose-600 hover:bg-rose-500/10"
                                  >
                                    <XCircle className="h-4 w-4" />
                                  </Button>
                                </>
                              )}
                              {slip.status === "approved" && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  title={t("warehouseSlips.reprint")}
                                  onClick={() => setPrintData(warehouseSlipToPrintData(slip))}
                                  className="text-indigo-600"
                                >
                                  <Printer className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
            </TableWrap>
          )}
        </Card>
      </main>

      {printData && (
        <div className="print-area">
          <WarehouseSlipPrintTemplate slip={printData} />
        </div>
      )}
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}
