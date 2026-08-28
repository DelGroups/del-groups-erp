"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import Link from "next/link";
import PolywoodImportPanel from "@/components/polywood/PolywoodImportPanel";
import { ensurePolywoodWarehouseAction } from "@/lib/actions/polywood";
import {
  fetchAllPolywoodInventory,
  type PolywoodProductInventoryRow,
} from "@/lib/polywood/inventory";
import { useI18n } from "@/i18n/I18nProvider";
import type { Warehouse } from "@/types/database.types";
import { Layers, Package, RefreshCw, Upload } from "lucide-react";

export default function PolywoodPageClient() {
  const { t } = useI18n();
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);
  const [rows, setRows] = useState<PolywoodProductInventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"inventory" | "import">("inventory");
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const whResult = await ensurePolywoodWarehouseAction();
      if (!whResult.success || !whResult.data?.warehouse) {
        setError(whResult.error || t("polywood.loadError"));
        setLoading(false);
        return;
      }

      const wh = whResult.data.warehouse;
      setWarehouse(wh);
      const inventory = await fetchAllPolywoodInventory(wh.id);
      setRows(inventory);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("polywood.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.products += 1;
        acc.totalLength += row.summary.total_length_m;
        acc.fullSheets += row.summary.full_sheet_count;
        acc.cutPieces += row.summary.available_piece_count - row.summary.full_sheet_count;
        return acc;
      },
      { products: 0, totalLength: 0, fullSheets: 0, cutPieces: 0 }
    );
  }, [rows]);

  return (
    <PageLayout>
      <header className="app-glass flex flex-wrap items-center justify-between gap-4 border-b border-app px-6 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-app">
            <Layers className="h-6 w-6 text-app-accent" />
            {t("polywood.pageTitle")}
          </h2>
          <p className="text-sm text-app-muted">{t("polywood.pageDescription")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/sales/polywood/new"
            className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            {t("sales.polywoodInvoice")}
          </Link>
          <Link
            href="/inventory-audit"
            className="rounded-lg border border-app bg-app-card-hover px-3 py-2 text-xs font-semibold text-app hover:bg-app-card-hover"
          >
            {t("nav.items.inventoryAudit")}
          </Link>
          <button type="button" onClick={loadData} className="btn-secondary">
            <RefreshCw className="h-4 w-4" />
            {t("common.refresh")}
          </button>
        </div>
      </header>

      <main className="flex-1 space-y-6 overflow-y-auto p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="app-card p-4">
            <p className="text-xs text-app-muted">{t("polywood.stats.warehouse")}</p>
            <p className="mt-1 text-lg font-bold text-app">{warehouse?.name || "—"}</p>
          </div>
          <div className="app-card p-4">
            <p className="text-xs text-app-muted">{t("polywood.stats.products")}</p>
            <p className="mt-1 text-lg font-bold text-app">{totals.products}</p>
          </div>
          <div className="app-card p-4">
            <p className="text-xs text-app-muted">{t("polywood.stats.totalLength")}</p>
            <p className="mt-1 text-lg font-bold text-app">{totals.totalLength.toFixed(2)} m</p>
          </div>
          <div className="app-card p-4">
            <p className="text-xs text-app-muted">{t("polywood.stats.fullSheets")}</p>
            <p className="mt-1 text-lg font-bold text-app">{totals.fullSheets}</p>
          </div>
        </div>

        <div className="flex gap-2 border-b border-app">
          <button
            type="button"
            onClick={() => setActiveTab("inventory")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-semibold ${
              activeTab === "inventory"
                ? "border-app-accent text-app-accent"
                : "border-transparent text-app-muted"
            }`}
          >
            <Package className="h-4 w-4" />
            {t("polywood.tabs.inventory")}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("import")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-semibold ${
              activeTab === "import"
                ? "border-app-accent text-app-accent"
                : "border-transparent text-app-muted"
            }`}
          >
            <Upload className="h-4 w-4" />
            {t("polywood.tabs.import")}
          </button>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {activeTab === "import" ? (
          <PolywoodImportPanel onImported={loadData} />
        ) : loading ? (
          <p className="text-sm text-app-muted">{t("common.loading")}</p>
        ) : rows.length === 0 ? (
          <div className="app-card p-8 text-center text-sm text-app-muted">
            {t("polywood.emptyInventory")}
          </div>
        ) : (
          <div className="app-table-wrap">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-app-card-hover text-xs font-bold uppercase text-app">
                <tr>
                  <th className="p-3">{t("polywood.table.product")}</th>
                  <th className="p-3">{t("polywood.table.code")}</th>
                  <th className="p-3 text-right">{t("polywood.table.totalLength")}</th>
                  <th className="p-3 text-right">{t("polywood.table.fullSheets")}</th>
                  <th className="p-3">{t("polywood.table.cutBreakdown")}</th>
                  <th className="p-3 text-right">{t("polywood.table.pieces")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app">
                {rows.map(({ product, summary }) => {
                  const isExpanded = expandedProductId === product.id;
                  return (
                    <React.Fragment key={product.id}>
                      <tr
                        className="cursor-pointer hover:bg-app-card-hover"
                        onClick={() =>
                          setExpandedProductId(isExpanded ? null : product.id)
                        }
                      >
                        <td className="p-3 font-medium text-app">{product.name}</td>
                        <td className="p-3 font-mono text-xs text-app-muted">{product.code}</td>
                        <td className="p-3 text-right font-mono">
                          {summary.total_length_m.toFixed(2)} m
                        </td>
                        <td className="p-3 text-right">
                          {summary.full_sheet_count} × {summary.full_sheet_length_m}m
                        </td>
                        <td className="p-3 text-xs text-app-muted">
                          {summary.cut_pieces.length > 0
                            ? summary.cut_pieces
                                .map((piece) => `${piece.count}×${piece.length_m}m`)
                                .join(", ")
                            : "—"}
                        </td>
                        <td className="p-3 text-right">{summary.available_piece_count}</td>
                      </tr>
                      {isExpanded ? (
                        <tr className="bg-app-card-hover/50">
                          <td colSpan={6} className="p-4">
                            <p className="mb-2 text-xs font-bold uppercase text-app-muted">
                              {t("polywood.pieceDetails")}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {Array.from({ length: summary.full_sheet_count }).map((_, idx) => (
                                <span
                                  key={`full-${idx}`}
                                  className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800"
                                >
                                  {summary.full_sheet_length_m}m {t("polywood.fullSheet")}
                                </span>
                              ))}
                              {summary.cut_pieces.flatMap((piece) =>
                                Array.from({ length: piece.count }).map((_, idx) => (
                                  <span
                                    key={`cut-${piece.length_m}-${idx}`}
                                    className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800"
                                  >
                                    {piece.length_m}m {t("polywood.cutPiece")}
                                  </span>
                                ))
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </PageLayout>
  );
}
