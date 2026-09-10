"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Minus, Package, Plus, Search, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import {
  fetchCompositeBomIndexAction,
  fetchProductStocksBatchAction,
  resolveConfiguratorKitAction,
} from "@/lib/actions/productBom";
import {
  buildConfiguratorKitPreview,
  computeConfiguratorStock,
  findCompositeByComponents,
  listBaseConfiguratorOptions,
  listConfiguratorComponents,
  listSeatConfiguratorOptions,
  type CompositeBomIndexEntry,
} from "@/lib/products/modularRoles";
import { productCode } from "@/lib/products/productOptionLabel";
import type { Product } from "@/types/database.types";

type TabId = "standard" | "configurator";

type InvoiceProductSelectorModalProps = {
  open: boolean;
  products: Product[];
  onClose: () => void;
  onSelect: (product: Product, quantity: number, closeAfter: boolean) => void;
};

function productMatchesQuery(product: Product, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    (product.name || "").toLowerCase().includes(q) ||
    (product.code || "").toLowerCase().includes(q) ||
    (product.sku || "").toLowerCase().includes(q) ||
    (product.barcode || "").toLowerCase().includes(q)
  );
}

function productPrice(product: Product): number {
  return Number(product.sell_price ?? product.sale_price ?? product.price) || 0;
}

function QuantityStepper({
  value,
  onChange,
  min = 1,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
}) {
  const dec = () => onChange(Math.max(min, value - 1));
  const inc = () => onChange(value + 1);

  return (
    <div className="inline-flex items-center overflow-hidden rounded-lg border border-app">
      <button
        type="button"
        onClick={dec}
        className="px-2 py-1 hover:bg-app-card-hover"
        aria-label="-"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <input
        type="number"
        min={min}
        step="1"
        value={value}
        onChange={(e) => onChange(Math.max(min, Math.floor(Number(e.target.value) || min)))}
        className="w-12 border-x border-app py-1 text-center text-xs font-mono"
      />
      <button
        type="button"
        onClick={inc}
        className="px-2 py-1 hover:bg-app-card-hover"
        aria-label="+"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function InvoiceProductSelectorModal({
  open,
  products,
  onClose,
  onSelect,
}: InvoiceProductSelectorModalProps) {
  const { t } = useI18n();
  const searchRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<TabId>("standard");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [stockMap, setStockMap] = useState<Record<string, number>>({});
  const [loadingStocks, setLoadingStocks] = useState(false);
  const [bomIndex, setBomIndex] = useState<CompositeBomIndexEntry[]>([]);
  const [seatId, setSeatId] = useState("");
  const [baseId, setBaseId] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [configuratorQty, setConfiguratorQty] = useState(1);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [closeAfterSelect, setCloseAfterSelect] = useState(true);
  const [resolvingKit, setResolvingKit] = useState(false);
  const [kitError, setKitError] = useState<string | null>(null);

  const categoryPills = useMemo(() => {
    const set = new Set<string>();
    products.forEach((product) => {
      if (product.category?.trim()) set.add(product.category.trim());
      if (product.subcategory?.trim()) set.add(product.subcategory.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "az"));
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products
      .filter((product) => productMatchesQuery(product, query))
      .filter((product) => {
        if (!categoryFilter) return true;
        return product.category === categoryFilter || product.subcategory === categoryFilter;
      })
      .slice(0, 120);
  }, [products, query, categoryFilter]);

  const seatOptions = useMemo(() => listSeatConfiguratorOptions(products), [products]);
  const baseOptions = useMemo(() => listBaseConfiguratorOptions(products), [products]);

  const selectedSeat = useMemo(
    () => seatOptions.find((product) => product.id === seatId) || null,
    [seatOptions, seatId]
  );
  const selectedBase = useMemo(
    () => baseOptions.find((product) => product.id === baseId) || null,
    [baseOptions, baseId]
  );

  const matchedComposite = useMemo(() => {
    if (!seatId || !baseId) return null;
    return findCompositeByComponents(bomIndex, products, seatId, baseId);
  }, [bomIndex, products, seatId, baseId]);

  const configuratorStock = useMemo(() => {
    if (!seatId || !baseId) return null;
    if (matchedComposite) {
      const stock = stockMap[matchedComposite.id];
      return stock != null ? stock : null;
    }
    const seatStock = stockMap[seatId];
    const baseStock = stockMap[baseId];
    if (seatStock == null || baseStock == null) return null;
    return computeConfiguratorStock(seatStock, baseStock);
  }, [matchedComposite, seatId, baseId, stockMap]);

  const configuratorPreview = useMemo(() => {
    if (!selectedSeat || !selectedBase) return null;
    if (matchedComposite) return matchedComposite;
    const seatStock = stockMap[seatId] ?? (Number(selectedSeat.stock) || 0);
    const baseStock = stockMap[baseId] ?? (Number(selectedBase.stock) || 0);
    return buildConfiguratorKitPreview(selectedSeat, selectedBase, seatStock, baseStock);
  }, [selectedSeat, selectedBase, matchedComposite, seatId, baseId, stockMap]);

  const getQuantity = useCallback(
    (productId: string) => quantities[productId] ?? 1,
    [quantities]
  );

  const setQuantity = useCallback((productId: string, qty: number) => {
    setQuantities((prev) => ({ ...prev, [productId]: Math.max(1, qty) }));
  }, []);

  useEffect(() => {
    setHighlightIndex(0);
  }, [query, categoryFilter, filteredProducts.length]);

  useEffect(() => {
    if (!open) {
      setTab("standard");
      setQuery("");
      setCategoryFilter("");
      setSeatId("");
      setBaseId("");
      setStockMap({});
      setQuantities({});
      setConfiguratorQty(1);
      setHighlightIndex(0);
      setCloseAfterSelect(true);
      setResolvingKit(false);
      setKitError(null);
      return;
    }

    let active = true;
    void fetchCompositeBomIndexAction().then((result) => {
      if (!active || !result.success) return;
      setBomIndex(result.index);
    });

    const timer = window.setTimeout(() => searchRef.current?.focus(), 50);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (tab !== "standard" || event.target !== searchRef.current) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightIndex((idx) => Math.min(idx + 1, Math.max(filteredProducts.length - 1, 0)));
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightIndex((idx) => Math.max(idx - 1, 0));
        return;
      }

      if (event.key === "Enter" && filteredProducts.length > 0) {
        event.preventDefault();
        const product = filteredProducts[highlightIndex] ?? filteredProducts[0];
        if (product) {
          onSelect(product, getQuantity(product.id), closeAfterSelect);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    open,
    tab,
    onClose,
    onSelect,
    filteredProducts,
    highlightIndex,
    getQuantity,
    closeAfterSelect,
  ]);

  useEffect(() => {
    if (!open || tab !== "standard") return;
    const ids = filteredProducts.map((product) => product.id);
    if (ids.length === 0) return;

    let active = true;
    setLoadingStocks(true);
    void fetchProductStocksBatchAction(ids).then((result) => {
      if (!active) return;
      if (result.success) {
        setStockMap((prev) => ({ ...prev, ...result.stocks }));
      }
      setLoadingStocks(false);
    });

    return () => {
      active = false;
    };
  }, [open, tab, filteredProducts]);

  useEffect(() => {
    if (!open || tab !== "configurator") return;

    const componentIds = listConfiguratorComponents(products).map((product) => product.id);
    if (componentIds.length === 0) return;

    let active = true;
    setLoadingStocks(true);
    void fetchProductStocksBatchAction(componentIds).then((result) => {
      if (!active) return;
      if (result.success) {
        setStockMap((prev) => ({ ...prev, ...result.stocks }));
      }
      setLoadingStocks(false);
    });

    return () => {
      active = false;
    };
  }, [open, tab, products]);

  useEffect(() => {
    if (!open || tab !== "configurator") return;
    const ids = [matchedComposite?.id].filter(Boolean) as string[];
    if (ids.length === 0) return;

    let active = true;
    void fetchProductStocksBatchAction(ids).then((result) => {
      if (!active || !result.success) return;
      setStockMap((prev) => ({ ...prev, ...result.stocks }));
    });

    return () => {
      active = false;
    };
  }, [open, tab, matchedComposite?.id]);

  useEffect(() => {
    setKitError(null);
  }, [seatId, baseId, tab]);

  const resolveStock = (product: Product): number => {
    const override = stockMap[product.id];
    if (override != null && Number.isFinite(override)) return override;
    return Number(product.stock) || 0;
  };

  const finishSelect = (product: Product, quantity: number) => {
    onSelect(product, quantity, closeAfterSelect);
  };

  const handleStandardSelect = (product: Product) => {
    finishSelect(product, getQuantity(product.id));
  };

  const handleConfiguratorAdd = async () => {
    if (!seatId || !baseId || seatId === baseId) return;

    setResolvingKit(true);
    setKitError(null);

    const result = await resolveConfiguratorKitAction(seatId, baseId);
    setResolvingKit(false);

    if (!result.success || !result.product) {
      setKitError(result.error || t("invoice.productSelector.kitResolveFailed"));
      return;
    }

    const resolvedProduct = {
      ...(result.product as Product),
      stock: result.stock ?? 0,
      is_composite: true,
    };

    finishSelect(resolvedProduct, configuratorQty);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto app-scrim p-4">
      <div className="my-4 flex w-full max-w-4xl flex-col app-modal">
        <div className="flex items-center justify-between border-b border-app px-5 py-4">
          <div>
            <h3 className="text-sm font-bold text-app">{t("invoice.productSelector.title")}</h3>
            <p className="text-xs text-app-muted">{t("invoice.productSelector.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-app-muted hover:bg-app-card-hover"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex gap-2 border-b border-app px-5 pt-3">
          <button
            type="button"
            onClick={() => setTab("standard")}
            className={`rounded-t-lg px-4 py-2 text-xs font-semibold ${
              tab === "standard"
                ? "border border-b-0 border-app bg-app-card text-app"
                : "text-app-muted hover:text-app"
            }`}
          >
            {t("invoice.productSelector.tabStandard")}
          </button>
          <button
            type="button"
            onClick={() => setTab("configurator")}
            className={`rounded-t-lg px-4 py-2 text-xs font-semibold ${
              tab === "configurator"
                ? "border border-b-0 border-app bg-app-card text-app"
                : "text-app-muted hover:text-app"
            }`}
          >
            {t("invoice.productSelector.tabConfigurator")}
          </button>
        </div>

        {tab === "standard" ? (
          <div className="space-y-4 p-5">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-app-muted" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("invoice.productSearchPlaceholder")}
                className="w-full rounded-lg border border-app py-2 pl-9 pr-3 text-sm"
              />
            </label>
            <p className="text-[10px] text-app-muted">{t("invoice.productSelector.keyboardHint")}</p>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setCategoryFilter("")}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  !categoryFilter
                    ? "bg-[image:var(--app-gradient)] text-white"
                    : "border border-app bg-app-card-hover text-app"
                }`}
              >
                {t("common.all")}
              </button>
              {categoryPills.map((pill) => (
                <button
                  key={pill}
                  type="button"
                  onClick={() => setCategoryFilter(pill)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    categoryFilter === pill
                      ? "bg-[image:var(--app-gradient)] text-white"
                      : "border border-app bg-app-card-hover text-app"
                  }`}
                >
                  {pill}
                </button>
              ))}
            </div>

            <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-app">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 border-b border-app bg-app-card-hover text-app-muted">
                  <tr>
                    <th className="px-3 py-2 font-bold">{t("products.code")}</th>
                    <th className="px-3 py-2 font-bold">{t("products.name")}</th>
                    <th className="px-3 py-2 font-bold">{t("products.stock")}</th>
                    <th className="px-3 py-2 font-bold">{t("products.price")}</th>
                    <th className="px-3 py-2 font-bold">{t("forms.quantity")}</th>
                    <th className="px-3 py-2 font-bold" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-app">
                  {filteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-app-muted">
                        {t("invoice.productNotFound")}
                      </td>
                    </tr>
                  ) : (
                    filteredProducts.map((product, idx) => {
                      const stock = resolveStock(product);
                      const unit = product.unit || "Ədəd";
                      const active = idx === highlightIndex;
                      return (
                        <tr
                          key={product.id}
                          className={`hover:bg-app-card-hover ${active ? "bg-indigo-50/80" : ""}`}
                          onMouseEnter={() => setHighlightIndex(idx)}
                        >
                          <td className="px-3 py-2 font-mono">{productCode(product) || "-"}</td>
                          <td className="px-3 py-2">
                            <div className="font-medium text-app">{product.name}</div>
                            {product.is_composite ? (
                              <span className="text-[10px] font-bold uppercase text-indigo-600">
                                {t("products.bom.compositeBadge")}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 font-semibold">
                            {loadingStocks && stockMap[product.id] == null
                              ? "…"
                              : `${stock} ${unit}`}
                          </td>
                          <td className="px-3 py-2">{productPrice(product).toFixed(2)} AZN</td>
                          <td className="px-3 py-2">
                            <QuantityStepper
                              value={getQuantity(product.id)}
                              onChange={(qty) => setQuantity(product.id, qty)}
                            />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => handleStandardSelect(product)}
                              className="rounded-lg bg-[image:var(--app-gradient)] px-3 py-1.5 text-[11px] font-bold text-white"
                            >
                              {t("common.select")}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="space-y-5 p-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="block text-xs font-semibold text-app">
                {t("invoice.productSelector.seatLabel")}
                <select
                  value={seatId}
                  onChange={(e) => setSeatId(e.target.value)}
                  className="app-input mt-1 text-sm"
                >
                  <option value="">{t("invoice.productSelector.selectSeat")}</option>
                  {seatOptions.map((product) => (
                    <option key={product.id} value={product.id}>
                      {productCode(product)} — {product.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs font-semibold text-app">
                {t("invoice.productSelector.baseLabel")}
                <select
                  value={baseId}
                  onChange={(e) => setBaseId(e.target.value)}
                  className="app-input mt-1 text-sm"
                >
                  <option value="">{t("invoice.productSelector.selectBase")}</option>
                  {baseOptions.map((product) => (
                    <option key={product.id} value={product.id}>
                      {productCode(product)} — {product.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {seatOptions.length === 0 || baseOptions.length === 0 ? (
              <p className="text-xs text-amber-700">{t("invoice.productSelector.noComponents")}</p>
            ) : null}

            {seatId && baseId ? (
              <div className="rounded-xl border border-app bg-app-card-hover p-4">
                {matchedComposite ? (
                  <p className="text-xs font-semibold text-emerald-700">
                    {t("invoice.productSelector.matchedKit")}
                  </p>
                ) : (
                  <p className="text-xs font-semibold text-indigo-700">
                    {t("invoice.productSelector.virtualKit")}
                  </p>
                )}
                {configuratorPreview ? (
                  <>
                    <p className="mt-1 text-sm font-bold text-app">{configuratorPreview.name}</p>
                    <p className="mt-1 font-mono text-xs text-app-muted">
                      {productCode(configuratorPreview)}
                    </p>
                  </>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
                  <span className="font-semibold text-app">
                    {t("products.stock")}:{" "}
                    <span className="font-mono text-app-accent">
                      {loadingStocks && configuratorStock == null
                        ? "…"
                        : configuratorStock ?? 0}
                    </span>{" "}
                    {configuratorPreview?.unit || "Ədəd"}
                  </span>
                  {configuratorPreview ? (
                    <span className="text-app-muted">
                      {productPrice(configuratorPreview).toFixed(2)} AZN
                    </span>
                  ) : null}
                  <QuantityStepper value={configuratorQty} onChange={setConfiguratorQty} />
                </div>
              </div>
            ) : (
              <p className="text-xs text-app-muted">{t("invoice.productSelector.configuratorHint")}</p>
            )}

            {kitError ? <p className="text-xs text-rose-600">{kitError}</p> : null}

            <button
              type="button"
              disabled={
                resolvingKit ||
                !seatId ||
                !baseId ||
                seatId === baseId ||
                configuratorStock == null ||
                configuratorStock <= 0
              }
              onClick={() => void handleConfiguratorAdd()}
              className="flex items-center gap-2 rounded-lg bg-[image:var(--app-gradient)] px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              <Package className="h-4 w-4" />
              {resolvingKit
                ? t("common.loading")
                : t("invoice.productSelector.addKit")}
            </button>
          </div>
        )}

        <div className="border-t border-app px-5 py-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-app">
            <input
              type="checkbox"
              checked={closeAfterSelect}
              onChange={(e) => setCloseAfterSelect(e.target.checked)}
            />
            {t("invoice.productSelector.closeAfterSelect")}
          </label>
        </div>
      </div>
    </div>
  );
}
