"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardCheck, Eye, Plus, Trash2 } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import PageHeader from "@/components/ui/page-header";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import Select from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import ToastMessage from "@/components/ui/ToastMessage";
import { TableRowActionsMenu } from "@/components/ui/table-row-actions-menu";
import { ActionsTd, ActionsTh, Table, TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import { InventoryCountStatusBadge, VarianceAmount } from "@/components/inventoryCount/InventoryCountStatusBadge";
import { useToast } from "@/hooks/useToast";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import {
  createInventoryCountAction,
  deleteInventoryCountAction,
  fetchInventoryCountsAction,
  fetchInventoryCountWarehousesAction,
  fetchWarehouseCategoriesAction,
} from "@/lib/inventoryCount/actions";
import {
  INVENTORY_COUNT_STATUSES,
  type InventoryCountDocument,
  type InventoryCountOption,
  type InventoryCountStatus,
  type WarehouseCategoryPath,
} from "@/lib/inventoryCount/types";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Mounted only while open, so every opening starts from a clean form.
 * Scope cascades Anbar → Kateqoriya → Alt kateqoriya; each list is built from
 * get_warehouse_active_categories, i.e. only what has stock in that warehouse.
 */
function CreateCountModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useI18n();
  const [warehouses, setWarehouses] = useState<InventoryCountOption[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [paths, setPaths] = useState<WarehouseCategoryPath[]>([]);
  const [pathsLoading, setPathsLoading] = useState(false);
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [countDate, setCountDate] = useState(today);
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
      setError(result.success ? null : result.error);
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
          <Input type="date" value={countDate} onChange={(e) => setCountDate(e.target.value)} />
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
        {error ? <p className="text-sm text-rose-600 sm:col-span-2">{error}</p> : null}
      </div>
    </Modal>
  );
}

export default function InventoryCountsPageClient() {
  const { t } = useI18n();
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

  return (
    <PageLayout>
      <PageHeader
        title={t("inventoryCount.listTitle")}
        subtitle={t("inventoryCount.listDescription")}
        icon={<ClipboardCheck className="h-5 w-5" />}
        actions={
          <Button onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-1">
            <Plus className="h-4 w-4" />
            {t("inventoryCount.newCount")}
          </Button>
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

      <TableWrap>
        <Table>
          <THead>
            <tr>
              <Th>{t("inventoryCount.docNo")}</Th>
              <Th>{t("inventoryCount.countDate")}</Th>
              <Th>{t("inventoryCount.warehouse")}</Th>
              <Th>{t("inventoryCount.scope")}</Th>
              <Th>{t("common.status")}</Th>
              <Th numeric>{t("inventoryCount.progress")}</Th>
              <Th numeric>{t("inventoryCount.variance")}</Th>
              <Th>{t("inventoryCount.responsible")}</Th>
              <ActionsTh>{t("common.actions")}</ActionsTh>
            </tr>
          </THead>
          <tbody className="divide-y divide-app">
            {loading ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-app-muted">
                  {t("common.loading")}
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-app-muted">
                  {t("inventoryCount.emptyList")}
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <Tr key={row.id} className="cursor-pointer" onClick={() => openCount(row.id)}>
                  <Td>
                    <Link
                      href={`/inventory/counts/${row.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-semibold text-app-accent hover:underline"
                    >
                      {row.document_number}
                    </Link>
                  </Td>
                  <Td>{row.count_date}</Td>
                  <Td>{row.warehouse_name || "—"}</Td>
                  <Td>
                    {row.category_name
                      ? [row.category_name, row.subcategory_name].filter(Boolean).join(" › ")
                      : t("inventoryCount.allCategories")}
                  </Td>
                  <Td>
                    <InventoryCountStatusBadge status={row.status} />
                  </Td>
                  <Td numeric>
                    {row.status === "draft" ? "—" : `${row.counted_count} / ${row.line_count}`}
                  </Td>
                  <Td numeric>
                    {row.status === "draft" ? "—" : <VarianceAmount value={row.total_variance_value} />}
                  </Td>
                  <Td>{row.responsible_name || row.created_by_name || "—"}</Td>
                  <ActionsTd onClick={(e) => e.stopPropagation()}>
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
                  </ActionsTd>
                </Tr>
              ))
            )}
          </tbody>
        </Table>
      </TableWrap>

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
