"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardCheck, Eye, FileSpreadsheet, Plus, Trash2 } from "lucide-react";
import { ListBodyCells, ListHeadCells, dash, useTableColumns, type TableColumn } from "@/components/lists/listTable";
import { exportXlsx, xlsxFileName } from "@/lib/export/exportXlsx";
import PageLayout from "@/components/layout/PageLayout";
import PageHeader from "@/components/ui/page-header";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import Select from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Modal } from "@/components/ui/modal";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import ToastMessage from "@/components/ui/ToastMessage";
import { TableRowActionsMenu } from "@/components/ui/table-row-actions-menu";
import { ActionsTd, ActionsTh, Table, TableWrap, THead, Tr } from "@/components/ui/table";
import { InventoryCountStatusBadge, VarianceAmount } from "./InventoryCountStatusBadge";
import { useToast } from "@/hooks/useToast";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import { cn } from "@/lib/cn";
import {
  createInventoryCountAction,
  deleteInventoryCountAction,
  fetchInventoryCountsAction,
  fetchInventoryCountWarehousesAction,
  fetchWarehouseCategoriesAction,
} from "../actions/inventoryCount";
import {
  INVENTORY_COUNT_STATUSES,
  type InventoryCountDocument,
  type InventoryCountOption,
  type InventoryCountStatus,
  type WarehouseCategoryPath,
} from "../lib/inventoryCountTypes";
import { countToday, isBackdated } from "../lib/inventoryCountDates";
import { ListGrid } from "@/components/lists/ListGrid";

/** "Backdated · <date>" next to a count whose book quantities are taken at the end of a past day. */
export function BackdatedBadge({ date }: { date: string }) {
  const { t } = useI18n();
  return <Badge variant="warning">{t("inventoryCount.backdatedBadge", { date })}</Badge>;
}

/**
 * Mounted only while open, so every opening starts from a clean form.
 * Scope cascades Anbar → Kateqoriya → Alt kateqoriya; each list is built from
 * get_warehouse_active_categories: every category with stockable products, stocked or not.
 * The date is today for everyone; admins may pick a past date (backdated count) after a warning.
 */
export function CreateCountModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useI18n();
  const { isAdmin } = useAuth();
  const today = countToday();
  const [warehouses, setWarehouses] = useState<InventoryCountOption[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [paths, setPaths] = useState<WarehouseCategoryPath[]>([]);
  const [pathsLoading, setPathsLoading] = useState(false);
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [countDate, setCountDate] = useState(today);
  const [confirmBackdate, setConfirmBackdate] = useState(false);
  const backdated = isBackdated(countDate, today);
  const [responsible, setResponsible] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ignores a slow response for a warehouse the user already switched away from.
  const pathsRequest = useRef(0);

  const loadPaths = useCallback(async (id: string) => {
    const request = ++pathsRequest.current;
    setPaths([]);
    if (!id) return;
    setPathsLoading(true);
    const result = await fetchWarehouseCategoriesAction(id);
    if (request !== pathsRequest.current) return;
    setPathsLoading(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setPaths(result.data || []);
  }, []);

  useEffect(() => {
    void fetchInventoryCountWarehousesAction().then((result) => {
      if (!result.success) {
        setError(result.error);
        return;
      }
      const list = result.data || [];
      setWarehouses(list);
      if (list[0]) {
        setWarehouseId(list[0].id);
        void loadPaths(list[0].id);
      }
    });
  }, [loadPaths]);

  const handleWarehouseChange = (id: string) => {
    setWarehouseId(id);
    setCategory("");
    setSubcategory("");
    setError(null);
    void loadPaths(id);
  };

  const categories = useMemo(() => {
    const totals = new Map<string, number>();
    for (const path of paths) {
      totals.set(path.category_name, (totals.get(path.category_name) || 0) + path.product_count);
    }
    return Array.from(totals, ([name, count]) => ({ name, count }));
  }, [paths]);

  const subcategories = useMemo(
    () =>
      paths
        .filter((path) => path.category_name === category && path.subcategory_name)
        .map((path) => ({ name: path.subcategory_name as string, count: path.product_count })),
    [paths, category]
  );

  const handleCreate = async () => {
    if (backdated && !confirmBackdate) {
      setConfirmBackdate(true);
      return;
    }
    setConfirmBackdate(false);
    setSaving(true);
    setError(null);
    const result = await createInventoryCountAction({
      count_date: countDate,
      warehouse_id: warehouseId,
      category_name: category || null,
      subcategory_name: category ? subcategory || null : null,
      responsible_name: responsible,
      notes,
    });
    setSaving(false);
    if (!result.success || !result.data) {
      // Date rule errors come back as i18n keys.
      setError(result.success ? null : result.error.startsWith("inventoryCount.") ? t(result.error) : result.error);
      return;
    }
    onCreated(result.data.id);
  };

  return (
    <Modal
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={t("inventoryCount.createTitle")}
      description={t("inventoryCount.createHint")}
      className="max-w-lg"
      footer={
        <>
          <Button appearance="outline" color="secondary" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void handleCreate()} loading={saving} disabled={!warehouseId || pathsLoading}>
            {t("inventoryCount.create")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="erp-label">{t("inventoryCount.warehouse")}</label>
          <Select value={warehouseId} onChange={(e) => handleWarehouseChange(e.target.value)}>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="erp-label">{t("inventoryCount.category")}</label>
          <Select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setSubcategory("");
            }}
            disabled={pathsLoading || categories.length === 0}
          >
            <option value="">
              {pathsLoading ? t("inventoryCount.loadingCategories") : t("inventoryCount.allCategories")}
            </option>
            {categories.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} ({c.count})
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="erp-label">{t("inventoryCount.subcategory")}</label>
          <Select
            value={subcategory}
            onChange={(e) => setSubcategory(e.target.value)}
            disabled={!category || subcategories.length === 0}
          >
            <option value="">{t("inventoryCount.allSubcategories")}</option>
            {subcategories.map((sc) => (
              <option key={sc.name} value={sc.name}>
                {sc.name} ({sc.count})
              </option>
            ))}
          </Select>
        </div>
        {!pathsLoading && warehouseId && categories.length === 0 ? (
          <p className="text-xs text-app-muted sm:col-span-2">{t("inventoryCount.noCategoriesInWarehouse")}</p>
        ) : null}
        <div>
          <label className="erp-label">{t("inventoryCount.countDate")}</label>
          <Input
            type="date"
            value={countDate}
            max={today}
            readOnly={!isAdmin}
            aria-describedby="count-date-hint"
            onChange={(e) => setCountDate(e.target.value || today)}
          />
          {!isAdmin ? (
            <p id="count-date-hint" className="mt-1 text-xs text-app-muted">
              {t("inventoryCount.dateTodayOnly")}
            </p>
          ) : null}
        </div>
        <div>
          <label className="erp-label">{t("inventoryCount.responsible")}</label>
          <Input value={responsible} onChange={(e) => setResponsible(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="erp-label">{t("inventoryCount.notes")}</label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="app-input w-full resize-none text-sm"
          />
        </div>
        {backdated ? (
          <Alert variant="warning" className="sm:col-span-2" id="count-date-hint">
            {t("inventoryCount.backdatedWarning")}
          </Alert>
        ) : null}
        {error ? <p className="text-sm text-rose-600 sm:col-span-2">{error}</p> : null}
      </div>
      <Modal
        open={confirmBackdate}
        onOpenChange={(next) => (next || saving ? undefined : setConfirmBackdate(false))}
        title={t("inventoryCount.backdatedConfirmTitle")}
        className="max-w-md"
        footer={
          <>
            <Button appearance="outline" color="secondary" onClick={() => setConfirmBackdate(false)} disabled={saving}>
              {t("common.cancel")}
            </Button>
            <Button color="warning" onClick={() => void handleCreate()} loading={saving}>
              {t("inventoryCount.create")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-app">{t("inventoryCount.backdatedConfirm", { date: countDate })}</p>
      </Modal>
    </Modal>
  );
}

/** Column choice key of this list (prompt 24c). */
const COUNTS_LIST_KEY = "inventory.counts";

export default function InventoryCountsPage() {
  const { t, formatDateTime } = useI18n();
  const router = useRouter();
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const [rows, setRows] = useState<InventoryCountDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<InventoryCountStatus | "all">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<InventoryCountDocument | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    const result = await fetchInventoryCountsAction();
    if (result.success) setRows(result.data || []);
    else showError(result.error);
    setLoading(false);
  }, [showError]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: rows.length };
    for (const row of rows) map[row.status] = (map[row.status] || 0) + 1;
    return map;
  }, [rows]);

  const visible = statusFilter === "all" ? rows : rows.filter((row) => row.status === statusFilter);

  // Columns of the list (prompt 24c): counts have no salesperson ("Responsible" is a column).
  const columnDefs = useMemo<TableColumn<InventoryCountDocument>[]>(
    () => [
      {
        key: "document_number",
        labelKey: "inventoryCount.docNo",
        defaultVisible: true,
        required: true,
        exportValue: (row) => row.document_number,
        cell: (row) => (
          <Link href={`/inventory/counts/${row.id}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-app-accent hover:underline">
            {row.document_number}
          </Link>
        ),
      },
      {
        key: "count_date",
        labelKey: "listColumns.documentDate",
        offLabelKey: "inventoryCount.countDate",
        defaultVisible: true,
        exportType: "date",
        exportValue: (row) => row.count_date,
        cell: (row) => <span className="flex flex-wrap items-center gap-1.5">{row.book_as_of ? <BackdatedBadge date={row.count_date} /> : row.count_date}</span>,
      },
      { key: "warehouse", labelKey: "inventoryCount.warehouse", defaultVisible: true, cell: (row) => row.warehouse_name || "—" },
      { key: "scope", labelKey: "inventoryCount.scope", defaultVisible: true, cell: (row) => (row.category_name ? [row.category_name, row.subcategory_name].filter(Boolean).join(" › ") : t("inventoryCount.allCategories")) },
      { key: "status", labelKey: "common.status", defaultVisible: true, exportValue: (row) => t(`inventoryCount.status_${row.status}`), cell: (row) => <InventoryCountStatusBadge status={row.status} /> },
      { key: "progress", labelKey: "inventoryCount.progress", defaultVisible: true, numeric: true, exportValue: (row) => (row.status === "draft" ? null : `${row.counted_count} / ${row.line_count}`), cell: (row) => (row.status === "draft" ? "—" : `${row.counted_count} / ${row.line_count}`) },
      { key: "variance", labelKey: "inventoryCount.variance", defaultVisible: true, numeric: true, exportType: "money", exportValue: (row) => (row.status === "draft" ? null : row.total_variance_value), cell: (row) => (row.status === "draft" ? "—" : <VarianceAmount value={row.total_variance_value} />) },
      { key: "responsible", labelKey: "inventoryCount.responsible", defaultVisible: true, cell: (row) => row.responsible_name || row.created_by_name || "—" },
      { key: "created_at", labelKey: "listColumns.issuedAt", defaultVisible: true, standard: true, tdClassName: "whitespace-nowrap text-app-muted", exportType: "datetime", exportValue: (row) => row.created_at, cell: (row) => (row.created_at ? formatDateTime(row.created_at) : "—") },
      { key: "created_by", labelKey: "listColumns.createdBy", defaultVisible: true, standard: true, cell: (row) => dash(row.created_by_name) },
      { key: "surplus", labelKey: "inventory.engine.surplus", defaultVisible: false, numeric: true, exportValue: (row) => row.total_surplus_value, cell: (row) => <VarianceAmount value={row.total_surplus_value} /> },
      { key: "shortage", labelKey: "inventory.engine.shortage", defaultVisible: false, numeric: true, exportValue: (row) => row.total_shortage_value, cell: (row) => <VarianceAmount value={row.total_shortage_value} /> },
      { key: "notes", labelKey: "inventoryCount.notes", defaultVisible: false, tdClassName: "max-w-xs truncate", cell: (row) => dash(row.notes) },
    ],
    [t, formatDateTime]
  );
  const columns = useTableColumns(COUNTS_LIST_KEY, columnDefs);
  const handleExport = () => {
    if (!visible.length) return;
    void exportXlsx(xlsxFileName(t("inventoryCount.listTitle"), new Date()), { sheetName: t("inventoryCount.listTitle"), columns: columns.exportColumns, rows: visible });
  };
  const openCount = (id: string) => router.push(`/inventory/counts/${id}`);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await deleteInventoryCountAction(deleteTarget.id);
    setDeleting(false);
    if (!result.success) {
      showError(result.error);
      return;
    }
    setDeleteTarget(null);
    showSuccess(t("inventoryCount.deleted"));
    void load();
  };

  const rowActions = (row: InventoryCountDocument) => {
    return (
      <>
        <TableRowActionsMenu
          align="right"
          items={[
            {
              key: "open",
              label: t("common.view"),
              icon: <Eye className="h-4 w-4" />,
              onClick: () => openCount(row.id),
            },
            {
              key: "delete",
              label: t("common.delete"),
              icon: <Trash2 className="h-4 w-4" />,
              onClick: () => setDeleteTarget(row),
              hidden: row.status === "posted",
              variant: "destructive",
            },
          ]}
        />
      </>
    );
  };

  return (
    <PageLayout>
      <PageHeader
        title={t("inventoryCount.listTitle")}
        subtitle={t("inventoryCount.listDescription")}
        icon={<ClipboardCheck className="h-5 w-5" />}
        actions={
          <>
            {/* Excel and the column picker come with LIST_COLUMNS (prompt 24c). */}
            {columns.enabled && !columns.grid ? (
              <Button variant="secondary" onClick={handleExport} className="inline-flex items-center gap-1">
                <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                {t("common.excelDownload")}
              </Button>
            ) : null}
            {columns.picker}
            <Button onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-1">
              <Plus className="h-4 w-4" />
              {t("inventoryCount.newCount")}
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap gap-1.5">
        {(["all", ...INVENTORY_COUNT_STATUSES] as const).map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setStatusFilter(status)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
              statusFilter === status
                ? "border-[color:var(--erp-color-primary)] bg-[color:var(--erp-color-primary)] text-white"
                : "border-app bg-app-card text-app-muted hover:bg-app-card-hover"
            )}
          >
            {status === "all" ? t("inventoryCount.filterAll") : t(`inventoryCount.status_${status}`)}
            <span className="ms-1.5 opacity-70">{counts[status] || 0}</span>
          </button>
        ))}
      </div>

      {columns.grid ? (
        <ListGrid
          columns={columns}
          rows={visible}
          rowKey={(row) => row.id}
          label={t("inventoryCount.listTitle")}
          loading={loading}
          empty={<p className="text-sm ds-muted">{t("inventoryCount.emptyList")}</p>}
          onOpen={(row) => openCount(row.id)}
          rowActions={rowActions}
          onExport={columns.enabled ? handleExport : undefined}
        />
      ) : (
      <TableWrap>
        <Table>
          <THead>
            <tr>
              <ListHeadCells columns={columns.visible} />
              <ActionsTh>{t("common.actions")}</ActionsTh>
            </tr>
          </THead>
          <tbody className="divide-y divide-app">
            {loading ? (
              <tr>
                <td colSpan={columns.visible.length + 1} className="px-4 py-8 text-center text-app-muted">
                  {t("common.loading")}
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={columns.visible.length + 1} className="px-4 py-8 text-center text-app-muted">
                  {t("inventoryCount.emptyList")}
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <Tr key={row.id} className="cursor-pointer" onClick={() => openCount(row.id)}>
                  <ListBodyCells columns={columns.visible} row={row} />
                  <ActionsTd onClick={(e) => e.stopPropagation()}>{rowActions(row)}</ActionsTd>
                </Tr>
              ))
            )}
          </tbody>
        </Table>
      </TableWrap>
      )}

      {createOpen ? (
        <CreateCountModal
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => {
            setCreateOpen(false);
            openCount(id);
          }}
        />
      ) : null}
      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        message={deleteTarget ? t("inventoryCount.deleteConfirm", { docNo: deleteTarget.document_number }) : undefined}
        loading={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}
