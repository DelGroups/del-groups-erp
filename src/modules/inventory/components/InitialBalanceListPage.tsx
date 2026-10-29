"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Eye, FileSpreadsheet, Pencil, Plus, Trash2, Undo2, X } from "lucide-react";
import { dash, useTableColumns, type TableColumn } from "@/components/lists/listTable";
import { exportXlsx, xlsxFileName } from "@/lib/export/exportXlsx";

/** Column choice key of this list (prompt 24c). */
const INTAKE_LIST_KEY = "inventory.intake";
import PageLayout from "@/components/layout/PageLayout";
import PageHeader from "@/components/ui/page-header";
import Button from "@/components/ui/button";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import ToastMessage from "@/components/ui/ToastMessage";
import { TableRowActionsMenu } from "@/components/ui/table-row-actions-menu";
import { useAuth } from "@/components/auth/AuthProvider";
import { useToast } from "@/hooks/useToast";
import {
  deleteInitialBalanceDraftAction,
  fetchInitialBalanceListAction,
  unpostInitialBalanceDocumentAction,
} from "../actions/initialBalance";
import type { InitialBalanceDocument } from "../lib/initialBalanceTypes";
import { useI18n } from "@/i18n/I18nProvider";

/** Drafts open editable; posted/cancelled documents open read-only in the same form. */
const documentHref = (id: string) => `/warehouse/initial-balance/new?draft=${id}`;

/** Confirms returning a posted document to draft; the optional reason is stored on it. */
function UnpostConfirmModal({
  document,
  loading,
  onConfirm,
  onCancel,
}: {
  document: InitialBalanceDocument | null;
  loading: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (document) setReason("");
  }, [document]);

  if (!document) return null;

  return (
    <div className="fixed inset-0 z-[10003] flex items-center justify-center app-scrim p-4">
      <div className="app-modal w-full max-w-md overflow-hidden">
        <div className="flex items-start justify-between border-b border-app px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-sm font-bold text-app">{t("initialBalance.unpostConfirmTitle")}</h3>
              <p className="text-xs text-app-muted">{document.document_number}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-lg p-1.5 text-app-muted hover:bg-app-card-hover disabled:opacity-50"
            aria-label={t("common.close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-sm text-app-muted">{t("initialBalance.unpostConfirmMessage")}</p>
          <label className="block text-xs font-semibold text-app">
            {t("initialBalance.unpostReason")}
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={loading}
              className="app-input mt-1 w-full resize-none text-sm font-normal"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onCancel} disabled={loading} className="btn-secondary text-xs">
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => onConfirm(reason)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50"
            >
              <Undo2 className="h-4 w-4" />
              {loading ? t("initialBalance.unposting") : t("initialBalance.revertToDraft")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function InitialBalanceListPage() {
  const { t, formatDateTime } = useI18n();
  const router = useRouter();
  const { can } = useAuth();
  const canManage = can("can_manage_products");
  const canUnpost = can("can_unpost_inventory");
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const [rows, setRows] = useState<InitialBalanceDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<InitialBalanceDocument | null>(null);
  const [unpostTarget, setUnpostTarget] = useState<InitialBalanceDocument | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchInitialBalanceListAction();
    setRows(result.success ? result.data || [] : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    const result = await deleteInitialBalanceDraftAction(deleteTarget.id);
    setBusy(false);
    if (!result.success) {
      showError(result.error);
      return;
    }
    setDeleteTarget(null);
    showSuccess(t("initialBalance.draftDeleted"));
    void load();
  };

  const handleUnpost = async (reason: string) => {
    if (!unpostTarget) return;
    setBusy(true);
    const result = await unpostInitialBalanceDocumentAction(unpostTarget.id, reason);
    setBusy(false);
    if (!result.success) {
      showError(result.error);
      return;
    }
    showSuccess(
      t("initialBalance.unposted", {
        docNo: result.data?.document_number || unpostTarget.document_number,
      })
    );
    setUnpostTarget(null);
    void load();
  };

  // Columns of the list (prompt 24c): "Created by" is already a column; no salesperson.
  const columnDefs = useMemo<TableColumn<InitialBalanceDocument>[]>(
    () => [
      {
        key: "document_number",
        labelKey: "initialBalance.docNo",
        defaultVisible: true,
        required: true,
        exportValue: (row) => row.document_number,
        cell: (row) => (
          <Link href={documentHref(row.id)} className="font-semibold text-app-accent hover:underline">
            {row.document_number}
          </Link>
        ),
      },
      { key: "doc_date", labelKey: "listColumns.documentDate", offLabelKey: "common.date", defaultVisible: true, exportType: "date", exportValue: (row) => row.doc_date, cell: (row) => row.doc_date },
      { key: "entry_type", labelKey: "initialBalance.entryType", defaultVisible: true, cell: (row) => (row.entry_type === "receipt" ? t("initialBalance.entryTypeReceipt") : t("initialBalance.entryTypeOpeningBalance")) },
      { key: "warehouse", labelKey: "common.warehouse", defaultVisible: true, cell: (row) => row.warehouse_name || "—" },
      { key: "total_amount", labelKey: "initialBalance.totalValue", defaultVisible: true, numeric: true, tdClassName: "font-mono", exportValue: (row) => Number(row.total_amount || 0), cell: (row) => `${Number(row.total_amount || 0).toFixed(2)} AZN` },
      {
        key: "status",
        labelKey: "common.status",
        defaultVisible: true,
        cell: (row) => (row.status === "posted" ? t("initialBalance.statusPosted") : row.status === "cancelled" ? t("initialBalance.statusCancelled") : t("initialBalance.statusDraft")),
      },
      { key: "created_by", labelKey: "listColumns.createdBy", offLabelKey: "initialBalance.createdBy", defaultVisible: true, cell: (row) => row.created_by_name || "—" },
      { key: "created_at", labelKey: "listColumns.issuedAt", defaultVisible: true, standard: true, tdClassName: "whitespace-nowrap text-app-muted", exportType: "datetime", exportValue: (row) => row.created_at, cell: (row) => (row.created_at ? formatDateTime(row.created_at) : "—") },
      { key: "posted_at", labelKey: "inventory.engine.postedAt", defaultVisible: false, exportType: "datetime", exportValue: (row) => row.posted_at, cell: (row) => (row.posted_at ? formatDateTime(row.posted_at) : "—") },
      { key: "notes", labelKey: "inventoryCount.notes", defaultVisible: false, tdClassName: "max-w-xs truncate", cell: (row) => dash(row.notes) },
    ],
    [t, formatDateTime]
  );
  const columns = useTableColumns(INTAKE_LIST_KEY, columnDefs);
  const handleExport = () => {
    if (!rows.length) return;
    void exportXlsx(xlsxFileName(t("initialBalance.listTitle"), new Date()), { sheetName: t("initialBalance.listTitle"), columns: columns.exportColumns, rows });
  };

  return (
    <PageLayout>
      <PageHeader
        title={t("initialBalance.listTitle")}
        subtitle={t("initialBalance.listDescription")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* Excel and the column picker come with LIST_COLUMNS (prompt 24c). */}
            {columns.enabled ? (
              <Button variant="secondary" onClick={handleExport} className="inline-flex items-center gap-1">
                <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                {t("common.excelDownload")}
              </Button>
            ) : null}
            {columns.picker}
            <Link href="/warehouse/initial-balance/new?type=opening_balance">
              <Button variant="outline" className="inline-flex items-center gap-1">
                <Plus className="h-4 w-4" />
                {t("initialBalance.entryTypeOpeningBalance")}
              </Button>
            </Link>
            <Link href="/warehouse/initial-balance/new?type=receipt">
              <Button className="inline-flex items-center gap-1">
                <Plus className="h-4 w-4" />
                {t("initialBalance.entryTypeReceipt")}
              </Button>
            </Link>
          </div>
        }
      />

      <div className="app-card overflow-x-auto rounded-xl">
        <table className="min-w-full text-xs">
          <thead className="bg-app-card-hover text-app-muted">
            <tr>
              {columns.visible.map((c) => (
                <th key={c.key} className={c.numeric ? "px-3 py-2 text-right" : "px-3 py-2 text-left"}>
                  {c.label}
                </th>
              ))}
              <th className="w-12 px-3 py-2 text-center">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.visible.length + 1} className="px-3 py-8 text-center text-app-muted">
                  {t("common.loading")}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.visible.length + 1} className="px-3 py-8 text-center text-app-muted">
                  {t("initialBalance.emptyList")}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const isDraft = row.status === "draft";
                const isPosted = row.status === "posted";
                return (
                  <tr key={row.id} className="border-t border-app hover:bg-app-card-hover">
                    {columns.visible.map((c) => (
                      <td key={c.key} className={["px-3 py-2", c.numeric ? "text-right" : "", c.tdClassName ?? ""].join(" ").trim()}>
                        {c.cell(row)}
                      </td>
                    ))}
                    <td className="relative px-3 py-2 text-center">
                      <TableRowActionsMenu
                        align="right"
                        items={[
                          {
                            key: "view",
                            label: t("common.view"),
                            icon: <Eye className="h-4 w-4" />,
                            onClick: () => router.push(documentHref(row.id)),
                          },
                          {
                            key: "edit",
                            label: t("common.edit"),
                            icon: <Pencil className="h-4 w-4" />,
                            onClick: () => router.push(documentHref(row.id)),
                            hidden: !isDraft || !canManage,
                          },
                          {
                            key: "unpost",
                            label: t("initialBalance.revertToDraft"),
                            icon: <Undo2 className="h-4 w-4" />,
                            onClick: () => setUnpostTarget(row),
                            hidden: !isPosted || !canUnpost,
                          },
                          {
                            key: "delete",
                            label: t("common.delete"),
                            icon: <Trash2 className="h-4 w-4" />,
                            onClick: () => setDeleteTarget(row),
                            hidden: !isDraft || !canManage,
                            variant: "destructive",
                          },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        message={
          deleteTarget
            ? t("initialBalance.deleteDraftConfirm", { docNo: deleteTarget.document_number })
            : undefined
        }
        loading={busy}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
      <UnpostConfirmModal
        document={unpostTarget}
        loading={busy}
        onConfirm={(reason) => void handleUnpost(reason)}
        onCancel={() => setUnpostTarget(null)}
      />
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}
