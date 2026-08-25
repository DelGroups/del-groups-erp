"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageLayout from "@/components/layout/PageLayout";
import DamagedGoodsForm from "@/components/inventory/DamagedGoodsForm";
import DamagedGoodsViewModal from "@/components/inventory/DamagedGoodsViewModal";
import DamagedGoodsPrintTemplate, {
  type DamagedGoodsPrintData,
} from "@/components/inventory/DamagedGoodsPrintTemplate";
import DocumentListSearchBar from "@/components/documents/DocumentListSearchBar";
import DocumentListActions from "@/components/documents/DocumentListActions";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import { fetchProductsCatalog } from "@/lib/products/api";
import {
  fetchInventoryWriteoffs,
  type WriteoffRecord,
} from "@/lib/inventory/writeoff";
import type { Warehouse } from "@/types/database.types";
import { useDocumentPrint } from "@/hooks/useDocumentPrint";
import { useI18n } from "@/i18n/I18nProvider";
import { Trash2 } from "lucide-react";

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
  const { t } = useI18n();
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
        />

        <main className="flex-1 space-y-4 overflow-y-auto p-6">
          <DocumentListSearchBar
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder={t("damagedGoods.searchPlaceholder")}
            onRefresh={() => void loadData()}
            loading={loading}
          />

          <div className="app-table-wrap">
            {loading ? (
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
                      <th className="px-4 py-3">{t("common.docNo")}</th>
                      <th className="px-4 py-3">{t("common.date")}</th>
                      <th className="px-4 py-3">{t("common.warehouse")}</th>
                      <th className="px-4 py-3">{t("common.checker")}</th>
                      <th className="px-4 py-3">{t("common.productCount")}</th>
                      <th className="px-4 py-3 text-center">{t("common.actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-app">
                    {filteredWriteoffs.map((row) => (
                      <tr key={row.id} className="transition-colors hover:bg-app-card-hover">
                        <td className="px-4 py-3 font-mono font-bold text-app-accent">
                          {row.document_number}
                        </td>
                        <td className="px-4 py-3">{row.writeoff_date || "-"}</td>
                        <td className="px-4 py-3">
                          {getWarehouseName(warehouses, row.warehouse_id)}
                        </td>
                        <td className="px-4 py-3 font-semibold text-app">
                          {row.checker_name}
                        </td>
                        <td className="px-4 py-3">{row.items.length}</td>
                        <td className="px-4 py-3">
                          <DocumentListActions
                            onView={() => setViewingWriteoff(row)}
                            onPrint={() => handlePrint(row)}
                            onEdit={() => openEditForm(row)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>

      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm">
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
