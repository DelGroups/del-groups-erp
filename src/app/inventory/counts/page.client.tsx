"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  fetchInventoryCountOptionsAction,
  fetchInventoryCountsAction,
} from "@/lib/inventoryCount/actions";
import {
  INVENTORY_COUNT_STATUSES,
  type InventoryCountDocument,
  type InventoryCountOption,
  type InventoryCountStatus,
} from "@/lib/inventoryCount/types";

const today = () => new Date().toISOString().slice(0, 10);

/** Mounted only while open, so every opening starts from a clean form. */
function CreateCountModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useI18n();
  const [warehouses, setWarehouses] = useState<InventoryCountOption[]>([]);
  const [categories, setCategories] = useState<InventoryCountOption[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [countDate, setCountDate] = useState(today);
  const [responsible, setResponsible] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchInventoryCountOptionsAction().then((result) => {
      if (!result.success || !result.data) {
        setError(result.success ? null : result.error);
        return;
      }
      setWarehouses(result.data.warehouses);
      setCategories(result.data.categories);
      setWarehouseId((current) => current || result.data?.warehouses[0]?.id || "");
    });
  }, []);

  const handleCreate = async () => {
    setSaving(true);
    setError(null);
    const result = await createInventoryCountAction({
      count_date: countDate,
      warehouse_id: warehouseId,
      category_id: categoryId || null,
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
          <Button onClick={() => void handleCreate()} loading={saving} disabled={!warehouseId}>
            {t("inventoryCount.create")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="erp-label">{t("inventoryCount.warehouse")}</label>
          <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-2">
          <label className="erp-label">{t("inventoryCount.category")}</label>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">{t("inventoryCount.allCategories")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
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
                  <Td>{row.category_name || t("inventoryCount.allCategories")}</Td>
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
