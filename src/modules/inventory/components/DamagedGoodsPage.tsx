"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageLayout from "@/components/layout/PageLayout";
import DamagedGoodsForm from "./DamagedGoodsForm";
import DamagedGoodsViewModal from "./DamagedGoodsViewModal";
import DamagedGoodsPrintTemplate, {
  type DamagedGoodsPrintData,
} from "./DamagedGoodsPrintTemplate";
import DocumentListSearchBar from "@/components/documents/DocumentListSearchBar";
import DocumentListActions from "@/components/documents/DocumentListActions";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import { fetchProductsCatalog } from "@/lib/products/api";
import {
  fetchInventoryWriteoffs,
  type WriteoffRecord,
} from "../lib/writeoff";
import type { Warehouse } from "@/types/database.types";
import { useDocumentPrint } from "@/hooks/useDocumentPrint";
import { useI18n } from "@/i18n/I18nProvider";
import { FileSpreadsheet, Trash2 } from "lucide-react";
import Button from "@/components/ui/button";
import { dash, useTableColumns, type TableColumn } from "@/components/lists/listTable";
import { exportXlsx, xlsxFileName } from "@/lib/export/exportXlsx";
import { ListGrid } from "@/components/lists/ListGrid";

/** Column choice key of this list (prompt 24c). */
const WRITEOFFS_LIST_KEY = "inventory.writeoffs";

function getWarehouseName(warehouses: Warehouse[], warehouseId: string | null): string {
  if (!warehouseId) return "-";
  return warehouses.find((w) => w.id === warehouseId)?.name || "-";
}

function toPrintData(record: WriteoffRecord, warehouses: Warehouse[]): DamagedGoodsPrintData {
  return {
    document_number: record.document_number,
    writeoff_date: record.writeoff_date || "-",
    warehouse_name: getWarehouseName(warehouses, record.warehouse_id),
    checker_name: record.checker_name,
    items: record.items,
    notes: record.notes,
  };
}

export default function DamagedGoodsPage() {
  const { t, formatDateTime } = useI18n();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [writeoffs, setWriteoffs] = useState<WriteoffRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingWriteoff, setEditingWriteoff] = useState<WriteoffRecord | null>(null);
  const [viewingWriteoff, setViewingWriteoff] = useState<WriteoffRecord | null>(null);
  const { printData: printWriteoff, setPrintData: setPrintWriteoff } =
    useDocumentPrint<DamagedGoodsPrintData>();

  const loadData = useCallback(async () => {
    setLoading(true);
    const [catalog, rows] = await Promise.all([
      fetchProductsCatalog(),
      fetchInventoryWriteoffs(),
    ]);
    setWarehouses(catalog.warehouses);
    setWriteoffs(rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredWriteoffs = writeoffs.filter(
    (row) =>
      row.document_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      row.checker_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      getWarehouseName(warehouses, row.warehouse_id)
        .toLowerCase()
        .includes(searchTerm.toLowerCase())
  );

  // Columns of the list (prompt 24c): write-offs have no salesperson ("Checker" is a column).
  const columnDefs = useMemo<TableColumn<WriteoffRecord>[]>(
    () => [
      { key: "document_number", labelKey: "common.docNo", defaultVisible: true, required: true, tdClassName: "font-mono font-bold text-app-accent", cell: (row) => row.document_number },
      { key: "writeoff_date", labelKey: "listColumns.documentDate", offLabelKey: "common.date", defaultVisible: true, exportType: "date", exportValue: (row) => row.writeoff_date, cell: (row) => row.writeoff_date || "-" },
      { key: "warehouse", labelKey: "common.warehouse", defaultVisible: true, cell: (row) => getWarehouseName(warehouses, row.warehouse_id) },
      { key: "checker", labelKey: "common.checker", defaultVisible: true, tdClassName: "font-semibold text-app", cell: (row) => row.checker_name },
      { key: "item_count", labelKey: "common.productCount", defaultVisible: true, exportType: "integer", exportValue: (row) => row.items.length, cell: (row) => row.items.length },
      { key: "created_at", labelKey: "listColumns.issuedAt", defaultVisible: true, standard: true, tdClassName: "whitespace-nowrap text-app-muted", exportType: "datetime", exportValue: (row) => row.created_at, cell: (row) => (row.created_at ? formatDateTime(row.created_at) : "—") },
      { key: "created_by", labelKey: "listColumns.createdBy", defaultVisible: true, standard: true, cell: (row) => dash(row.created_by_name) },
      { key: "notes", labelKey: "inventoryCount.notes", defaultVisible: false, tdClassName: "max-w-xs truncate", cell: (row) => dash(row.notes) },
    ],
    [formatDateTime, warehouses]
  );
  const columns = useTableColumns(WRITEOFFS_LIST_KEY, columnDefs);
  const handleExport = () => {
    if (!filteredWriteoffs.length) return;
    void exportXlsx(xlsxFileName(t("damagedGoods.pageTitle"), new Date()), { sheetName: t("damagedGoods.pageTitle"), columns: columns.exportColumns, rows: filteredWriteoffs });
  };

  const openCreateForm = () => {
    setEditingWriteoff(null);
    setIsFormOpen(true);
  };

  const openEditForm = (row: WriteoffRecord) => {
    setEditingWriteoff(row);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingWriteoff(null);
  };

  const handleFormSuccess = () => {
    closeForm();
    void loadData();
  };

  const handlePrint = (row: WriteoffRecord) => {
    setPrintWriteoff(toPrintData(row, warehouses));
  };

  const rowActions = (row: WriteoffRecord) => {
    return (
      <>
        <DocumentListActions
          onView={() => setViewingWriteoff(row)}
          onPrint={() => handlePrint(row)}
          onEdit={() => openEditForm(row)}
        />
      </>
    );
  };

  return (
    <PageLayout>
        <DocumentPageHeader
          icon={<Trash2 className="h-6 w-6 text-rose-600" />}
          title={t("damagedGoods.pageTitle")}
          description={t("damagedGoods.pageDescription")}
          createLabel={t("damagedGoods.createDoc")}
          onCreate={openCreateForm}
          createDisabled={warehouses.length === 0}
          backLink={{ href: "/products", label: t("products.backToList") }}
          extraActions={
            // Excel comes with LIST_COLUMNS (prompt 24c): this list had no export.
            columns.enabled && !columns.grid ? (
              <Button type="button" variant="secondary" onClick={handleExport}>
                <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                {t("common.excelDownload")}
              </Button>
            ) : undefined
          }
        />

        <main className="app-page-content flex-1 space-y-3 overflow-y-auto md:space-y-4">
          <DocumentListSearchBar
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder={t("damagedGoods.searchPlaceholder")}
            onRefresh={() => void loadData()}
            loading={loading}
          />
          {columns.picker ? <div className="flex justify-end">{columns.picker}</div> : null}

          <div className={columns.grid ? undefined : "app-table-wrap"}>
            {columns.grid && warehouses.length > 0 ? (
              <ListGrid
                columns={columns}
                rows={filteredWriteoffs}
                rowKey={(row) => row.id}
                label={t("damagedGoods.pageTitle")}
                loading={loading}
                empty={<p className="text-xs ds-muted">{t("damagedGoods.emptyDocs")}</p>}
                onOpen={(row) => setViewingWriteoff(row)}
                rowActions={rowActions}
                onExport={columns.enabled ? handleExport : undefined}
              />
            ) : loading ? (
              <div className="p-12 text-center text-xs text-app-muted">{t("damagedGoods.loadingDocs")}</div>
            ) : warehouses.length === 0 ? (
              <div className="p-12 text-center text-xs text-app-muted">
                {t("damagedGoods.createWarehouseFirst")}{" "}
                <Link href="/warehouses" className="font-semibold text-app-accent hover:underline">
                  {t("damagedGoods.warehousesLink")}
                </Link>
              </div>
            ) : filteredWriteoffs.length === 0 ? (
              <div className="p-12 text-center text-xs text-app-muted">
                {t("damagedGoods.emptyDocs")}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-app bg-app-card-hover font-bold uppercase text-app">
                    <tr>
                      {columns.visible.map((c) => (
                        <th key={c.key} className="px-4 py-3">
                          {c.label}
                        </th>
                      ))}
                      <th className="px-4 py-3 text-center">{t("common.actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-app">
                    {filteredWriteoffs.map((row) => (
                      <tr key={row.id} className="transition-colors hover:bg-app-card-hover">
                        {columns.visible.map((c) => (
                          <td key={c.key} className={["px-4 py-3", c.tdClassName ?? ""].join(" ").trim()}>
                            {c.cell(row)}
                          </td>
                        ))}
                        <td className="px-4 py-3">{rowActions(row)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>

      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto app-scrim p-4">
          <div className="my-6 w-full max-w-5xl">
            <DamagedGoodsForm
              key={editingWriteoff?.id || "new"}
              warehouses={warehouses}
              mode={editingWriteoff ? "edit" : "create"}
              initialWriteoff={editingWriteoff}
              onCancel={closeForm}
              onSuccess={handleFormSuccess}
            />
          </div>
        </div>
      )}

      {viewingWriteoff && (
        <DamagedGoodsViewModal
          writeoff={viewingWriteoff}
          warehouses={warehouses}
          onClose={() => setViewingWriteoff(null)}
        />
      )}

      {printWriteoff && (
        <div className="print-area">
          <DamagedGoodsPrintTemplate writeoff={printWriteoff} />
        </div>
      )}
    </PageLayout>
  );
}
