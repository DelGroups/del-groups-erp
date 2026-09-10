"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Barcode, Plus, Save, Trash2 } from "lucide-react";
import type { Category, Product, ProductInsert, Warehouse } from "@/types/database.types";
import BarcodeDisplay from "@/components/products/BarcodeDisplay";
import QrCodeImage from "@/components/products/QrCodeImage";
import {
  calculateDimensionalInitialStockMeters,
  createProduct,
  getCategoryFullName,
  updateProduct,
} from "@/lib/products/api";
import { generateProductBarcode } from "@/lib/products/generateBarcode";
import { POLYWOOD_WAREHOUSE_TYPE } from "@/lib/polywood/constants";
import { matchesServiceCategoryName } from "@/lib/products/serviceCategory";
import { useI18n } from "@/i18n/I18nProvider";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import ProductBomBuilder, { type BomBuilderRow } from "@/components/products/ProductBomBuilder";
import { fetchProductBomAction, saveProductBomAction } from "@/lib/actions/productBom";
import { fetchProductsCatalog } from "@/lib/products/api";

interface ProductFormProps {
  categories: Category[];
  warehouses: Warehouse[];
  allProducts?: Product[];
  initialProduct?: Product | null;
  onSuccess?: () => void;
  onCancel?: () => void;
}

interface OffCutRow {
  id: string;
  length_m: string;
  count: string;
}

const UNITS = ["Ədəd", "Kq", "Litr", "Metr", "Qutu", "Xidmət"];

function createOffCutRow(): OffCutRow {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    length_m: "",
    count: "1",
  };
}

function resolvePolywoodWarehouseId(warehouses: Warehouse[]): string {
  return warehouses.find((w) => w.warehouse_type === POLYWOOD_WAREHOUSE_TYPE)?.id || "";
}

export default function ProductForm({
  categories,
  warehouses,
  allProducts = [],
  initialProduct,
  onSuccess,
  onCancel,
}: ProductFormProps) {
  const { t } = useI18n();
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const isEditMode = Boolean(initialProduct);

  const categoryByName = (name?: string | null) =>
    categories.find((cat) => cat.name === (name || "").trim()) || null;
  const initialCategory = categoryByName(initialProduct?.category) || null;
  const resolvedParent = initialCategory?.parent_id
    ? categories.find((cat) => cat.id === initialCategory.parent_id) || null
    : initialCategory;

  const [saving, setSaving] = useState(false);
  const [catalogProducts, setCatalogProducts] = useState<Product[]>(allProducts);
  const [isComposite, setIsComposite] = useState(Boolean(initialProduct?.is_composite));
  const [bomRows, setBomRows] = useState<BomBuilderRow[]>([]);
  const polywoodWarehouseId = useMemo(() => resolvePolywoodWarehouseId(warehouses), [warehouses]);
  const [fullSheetCount, setFullSheetCount] = useState("0");
  const [offCutRows, setOffCutRows] = useState<OffCutRow[]>([]);
  const [form, setForm] = useState({
    code: initialProduct?.code || "",
    name: initialProduct?.name || "",
    category: resolvedParent?.name || categories.find((cat) => !cat.parent_id)?.name || "",
    subcategory:
      initialCategory && initialCategory.parent_id
        ? initialCategory.name
        : initialProduct?.subcategory || "",
    unit: initialProduct?.unit || "Ədəd",
    buy_price: String(initialProduct?.buy_price ?? 0),
    sell_price: String(initialProduct?.sell_price ?? 0),
    stock: String(initialProduct?.stock ?? 0),
    min_stock: String(initialProduct?.min_stock ?? 5),
    barcode: initialProduct?.barcode || (!initialProduct ? generateProductBarcode() : ""),
    color: initialProduct?.color || "",
    weight: String(initialProduct?.weight ?? 0),
    extra_info: initialProduct?.extra_info || "",
    warehouse_id: polywoodWarehouseId || warehouses[0]?.id || "",
    is_dimensional: Boolean(initialProduct?.is_dimensional),
    is_composite: Boolean(initialProduct?.is_composite),
    base_length: String(initialProduct?.base_length ?? ""),
    base_width: String(initialProduct?.base_width ?? ""),
  });

  const set = (patch: Partial<typeof form>) => setForm((prev) => ({ ...prev, ...patch }));

  const parsedOffCuts = useMemo(
    () =>
      offCutRows
        .map((row) => ({
          length_m: parseFloat(row.length_m) || 0,
          count: Math.max(0, Math.floor(parseFloat(row.count) || 0)),
        }))
        .filter((row) => row.length_m > 0 && row.count > 0),
    [offCutRows]
  );

  const dimensionalInitialMeters = useMemo(() => {
    if (!form.is_dimensional) return 0;
    const baseLength = parseFloat(form.base_length) || 0;
    if (baseLength <= 0) return 0;
    return calculateDimensionalInitialStockMeters(
      baseLength,
      Math.max(0, Math.floor(parseFloat(fullSheetCount) || 0)),
      parsedOffCuts
    );
  }, [form.is_dimensional, form.base_length, fullSheetCount, parsedOffCuts]);

  const handleDimensionalToggle = (checked: boolean) => {
    set({
      is_dimensional: checked,
      unit: checked ? "Metr" : form.unit,
      warehouse_id: checked ? polywoodWarehouseId || form.warehouse_id : form.warehouse_id,
    });
    if (!checked) {
      setFullSheetCount("0");
      setOffCutRows([]);
    }
  };

  const addOffCutRow = () => setOffCutRows((prev) => [...prev, createOffCutRow()]);
  const updateOffCutRow = (id: string, patch: Partial<OffCutRow>) =>
    setOffCutRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const removeOffCutRow = (id: string) =>
    setOffCutRows((prev) => prev.filter((row) => row.id !== id));

  const parentCategories = categories.filter((cat) => !cat.parent_id);
  const selectedParent = categories.find((cat) => cat.name === form.category && !cat.parent_id);
  const availableSubcategories = selectedParent
    ? categories.filter((cat) => cat.parent_id === selectedParent.id)
    : [];
  const isServiceCategorySelected =
    matchesServiceCategoryName(form.category) || matchesServiceCategoryName(form.subcategory);

  const handleCategoryChange = (category: string) => {
    const serviceCategory = matchesServiceCategoryName(category);
    set({
      category,
      subcategory: "",
      is_dimensional: serviceCategory ? false : form.is_dimensional,
      unit: serviceCategory ? "Xidmət" : form.unit,
      stock: serviceCategory ? "0" : form.stock,
      min_stock: serviceCategory ? "0" : form.min_stock,
    });
    if (serviceCategory) {
      setFullSheetCount("0");
      setOffCutRows([]);
    }
  };

  const handleSubcategoryChange = (subcategory: string) => {
    const serviceCategory = matchesServiceCategoryName(subcategory);
    set({
      subcategory,
      is_dimensional: serviceCategory ? false : form.is_dimensional,
      is_composite: serviceCategory ? false : form.is_composite,
      unit: serviceCategory ? "Xidmət" : form.unit,
      stock: serviceCategory ? "0" : form.stock,
      min_stock: serviceCategory ? "0" : form.min_stock,
    });
    if (serviceCategory) {
      setFullSheetCount("0");
      setOffCutRows([]);
      setIsComposite(false);
      setBomRows([]);
    }
  };

  const handleCompositeToggle = (checked: boolean) => {
    setIsComposite(checked);
    set({
      is_composite: checked,
      stock: checked ? "0" : form.stock,
      is_dimensional: checked ? false : form.is_dimensional,
    });
    if (checked) {
      setFullSheetCount("0");
      setOffCutRows([]);
    } else {
      setBomRows([]);
    }
  };

  useEffect(() => {
    if (catalogProducts.length > 0) return;
    void fetchProductsCatalog().then((data) => {
      setCatalogProducts(data.products);
    });
  }, [catalogProducts.length]);

  useEffect(() => {
    if (!initialProduct?.id || !initialProduct.is_composite) return;
    void fetchProductBomAction(initialProduct.id).then((result) => {
      if (!result.success) return;
      setBomRows(
        result.rows.map((row) => ({
          id: row.id,
          componentProductId: row.componentProductId,
          quantity: String(row.quantity),
        }))
      );
    });
  }, [initialProduct?.id, initialProduct?.is_composite]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      showError(t("forms.enterProductName"));
      return;
    }

    if (isComposite && !isServiceCategorySelected) {
      const validBomRows = bomRows.filter(
        (row) => row.componentProductId && (parseFloat(row.quantity) || 0) > 0
      );
      if (validBomRows.length === 0) {
        showError(t("products.bom.required"));
        return;
      }
    }

    if (form.is_dimensional && !isEditMode && !isServiceCategorySelected && !isComposite) {
      const baseLength = parseFloat(form.base_length) || 0;
      if (baseLength <= 0 && (parseFloat(fullSheetCount) > 0 || parsedOffCuts.length > 0)) {
        showError(t("forms.baseLengthRequiredForInitialStock"));
        return;
      }
      if (!form.warehouse_id) {
        showError(t("forms.selectWarehouse"));
        return;
      }
    }

    setSaving(true);
    const selectedCategoryEntity =
      categories.find((cat) => cat.name === form.subcategory && cat.parent_id) ||
      categories.find((cat) => cat.name === form.category && !cat.parent_id) ||
      null;

    const payload: ProductInsert = {
      code: form.code,
      name: form.name,
      category: form.category || "Ümumi",
      subcategory: form.subcategory || null,
      category_id: selectedCategoryEntity?.id || null,
      unit: form.unit,
      buy_price: parseFloat(form.buy_price) || 0,
      sell_price: parseFloat(form.sell_price) || 0,
      stock:
        isServiceCategorySelected || isComposite
          ? 0
          : form.is_dimensional && !isEditMode
            ? dimensionalInitialMeters
            : parseFloat(form.stock) || 0,
      min_stock: isServiceCategorySelected ? 0 : parseFloat(form.min_stock) || 0,
      barcode: form.barcode || null,
      qr_code: form.barcode || null,
      color: form.color || null,
      weight: parseFloat(form.weight) || 0,
      extra_info: form.extra_info || null,
      is_dimensional: isServiceCategorySelected || isComposite ? false : form.is_dimensional,
      is_composite: isServiceCategorySelected ? false : isComposite,
      is_service: isServiceCategorySelected,
      base_length: !isServiceCategorySelected && form.is_dimensional ? parseFloat(form.base_length) || null : null,
      base_width: !isServiceCategorySelected && form.is_dimensional ? parseFloat(form.base_width) || null : null,
    };

    const result = isEditMode && initialProduct
      ? await updateProduct(initialProduct.id, payload)
      : await createProduct(
          payload,
          form.is_dimensional && !isServiceCategorySelected
            ? {
                warehouseId: form.warehouse_id,
                fullSheetCount: Math.max(0, Math.floor(parseFloat(fullSheetCount) || 0)),
                offCuts: parsedOffCuts,
              }
            : null
        );
    setSaving(false);

    if (!result.ok) {
      showError(t("common.errorOccurred", { message: formatRpcError(result.error, t) ?? t("common.error") }));
      return;
    }

    const savedProductId =
      isEditMode && initialProduct ? initialProduct.id : result.product?.id;

    if (savedProductId) {
      const bomPayload = bomRows
        .filter((row) => row.componentProductId && (parseFloat(row.quantity) || 0) > 0)
        .map((row) => ({
          componentProductId: row.componentProductId,
          quantity: parseFloat(row.quantity) || 1,
        }));

      const bomResult = await saveProductBomAction(
        savedProductId,
        bomPayload,
        isComposite && !isServiceCategorySelected
      );

      if (!bomResult.success) {
        showError(
          t("common.errorOccurred", {
            message: bomResult.error || t("products.bom.saveFailed"),
          })
        );
        return;
      }
    }

    showSuccess(isEditMode ? t("common.success") : t("forms.productCreated"));
    onSuccess?.();
  };

  return (
    <>
    <form onSubmit={handleSubmit} className="space-y-5 app-card app-card-elevated p-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="block text-xs font-semibold text-app">
          {t("forms.productCode")}
          <input
            type="text"
            value={form.code}
            onChange={(e) => set({ code: e.target.value })}
            placeholder={t("forms.autoGenerated")}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
          />
        </label>

        <label className="block text-xs font-semibold text-app">
          {t("forms.productName")}
          <input
            type="text"
            required
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
          />
        </label>

        <label className="block text-xs font-semibold text-app">
          {t("common.category")} *
          <select
            required
            value={form.category}
            onChange={(e) => handleCategoryChange(e.target.value)}
            className="app-input mt-1 text-sm"
          >
            <option value="">{t("common.select")}</option>
            {parentCategories.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs font-semibold text-app">
          {t("forms.subcategory")}
          <select
            value={form.subcategory}
            onChange={(e) => handleSubcategoryChange(e.target.value)}
            className="app-input mt-1 text-sm"
          >
            <option value="">{t("forms.notSelected")}</option>
            {availableSubcategories.map((c) => (
              <option key={c.id} value={c.name}>
                {getCategoryFullName(categories, c)}
              </option>
            ))}
          </select>
        </label>

        {!isServiceCategorySelected ? (
          <div className="flex flex-wrap items-end gap-4 md:col-span-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-app">
              <input
                type="checkbox"
                checked={form.is_dimensional}
                disabled={isComposite}
                onChange={(e) => handleDimensionalToggle(e.target.checked)}
              />
              {t("forms.isDimensionalProduct")}
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-app">
              <input
                type="checkbox"
                checked={isComposite}
                disabled={form.is_dimensional}
                onChange={(e) => handleCompositeToggle(e.target.checked)}
              />
              {t("products.bom.isComposite")}
            </label>
          </div>
        ) : (
          <p className="md:col-span-2 rounded-lg border border-app bg-app-card-hover px-3 py-2 text-xs text-app-muted">
            {t("forms.serviceProductHint")}
          </p>
        )}

        {form.is_dimensional && !isServiceCategorySelected ? (
          <>
            <label className="block text-xs font-semibold text-app">
              {t("forms.baseLength")} (m)
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.base_length}
                onChange={(e) => set({ base_length: e.target.value })}
                placeholder="4.10"
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              />
            </label>

            <label className="block text-xs font-semibold text-app">
              {t("forms.baseWidth")} (m)
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.base_width}
                onChange={(e) => set({ base_width: e.target.value })}
                placeholder="0.60"
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              />
            </label>
          </>
        ) : null}

        {!isServiceCategorySelected ? (
          <label className="block text-xs font-semibold text-app">
            {t("common.warehouse")}
            <select
              value={form.warehouse_id}
              onChange={(e) => set({ warehouse_id: e.target.value })}
              className="app-input mt-1 text-sm"
            >
              <option value="">{t("forms.notSelected")}</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="block text-xs font-semibold text-app">
          {t("forms.unitMeasure")}
          <select
            value={form.unit}
            onChange={(e) => set({ unit: e.target.value })}
            className="app-input mt-1 text-sm"
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs font-semibold text-app">
          {t("forms.buyPrice")} (AZN)
          <input
            type="number"
            step="0.01"
            value={form.buy_price}
            onChange={(e) => set({ buy_price: e.target.value })}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
          />
        </label>

        <label className="block text-xs font-semibold text-app">
          {t("forms.sellPrice")}
          <input
            type="number"
            step="0.01"
            value={form.sell_price}
            onChange={(e) => set({ sell_price: e.target.value })}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
          />
        </label>

        <div className="block text-xs font-semibold text-app">
          <label>
            {t("forms.barcode")}
            <div className="mt-1 flex gap-2">
              <input
                type="text"
                value={form.barcode}
                onChange={(e) => set({ barcode: e.target.value })}
                placeholder={t("forms.autoGenerated")}
                className="w-full rounded-lg border px-3 py-2 text-sm font-mono"
              />
              <button
                type="button"
                onClick={() => set({ barcode: generateProductBarcode() })}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-app px-3 py-2 text-xs font-semibold text-app hover:bg-app-card-hover"
              >
                <Barcode className="h-3.5 w-3.5" />
                {t("inventory.generateBarcode")}
              </button>
            </div>
          </label>
          {form.barcode.trim() && (
            <div className="mt-3 flex flex-wrap items-center gap-4 rounded-lg border border-app bg-app-card-hover p-3">
              <div>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-app-muted">
                  {t("forms.barcodePreview")}
                </p>
                <BarcodeDisplay value={form.barcode} />
              </div>
              <div>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-app-muted">
                  QR
                </p>
                <QrCodeImage value={form.barcode} size={72} />
              </div>
            </div>
          )}
        </div>

        <label className="block text-xs font-semibold text-app">
          {t("forms.color")}
          <input
            type="text"
            value={form.color}
            onChange={(e) => set({ color: e.target.value })}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
          />
        </label>

        <label className="block text-xs font-semibold text-app">
          {t("forms.weight")}
          <input
            type="number"
            step="0.001"
            value={form.weight}
            onChange={(e) => set({ weight: e.target.value })}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
          />
        </label>

        {isComposite && !isServiceCategorySelected ? (
          <div className="md:col-span-2">
            <ProductBomBuilder
              products={catalogProducts}
              parentProductId={initialProduct?.id}
              rows={bomRows}
              onChange={setBomRows}
            />
            <p className="mt-2 text-xs text-app-muted">{t("products.bom.stockHint")}</p>
          </div>
        ) : null}

        {!isServiceCategorySelected && !isComposite && (!form.is_dimensional || isEditMode) ? (
          <label className="block text-xs font-semibold text-app">
            {t("forms.initialStock")}
            <input
              type="number"
              value={form.stock}
              onChange={(e) => set({ stock: e.target.value })}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>
        ) : !isServiceCategorySelected && !isComposite && form.is_dimensional && !isEditMode ? (
          <div className="md:col-span-2 space-y-4 rounded-xl border border-app bg-app-card-hover p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-app pb-2">
              <h3 className="text-sm font-bold text-app">{t("forms.initialStockComposition")}</h3>
              <p className="text-xs text-app-muted">
                {t("forms.totalInitialMeterage")}:{" "}
                <span className="font-mono font-semibold text-app-accent">
                  {dimensionalInitialMeters.toFixed(2)} m
                </span>
              </p>
            </div>

            <label className="block text-xs font-semibold text-app">
              {t("forms.fullSheetCount")}
              <input
                type="number"
                min="0"
                step="1"
                value={fullSheetCount}
                onChange={(e) => setFullSheetCount(e.target.value)}
                placeholder="10"
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm md:max-w-xs"
              />
            </label>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-app">{t("forms.offCutRemainders")}</p>
              {offCutRows.length === 0 ? (
                <p className="text-xs text-app-muted">{t("forms.offCutRemaindersEmpty")}</p>
              ) : (
                <div className="space-y-2">
                  {offCutRows.map((row) => (
                    <div key={row.id} className="grid grid-cols-12 gap-2">
                      <label className="col-span-5 text-[10px] font-semibold text-app">
                        {t("forms.offCutLength")}
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={row.length_m}
                          onChange={(e) => updateOffCutRow(row.id, { length_m: e.target.value })}
                          placeholder="2.50"
                          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="col-span-5 text-[10px] font-semibold text-app">
                        {t("forms.offCutCount")}
                        <input
                          type="number"
                          step="1"
                          min="1"
                          value={row.count}
                          onChange={(e) => updateOffCutRow(row.id, { count: e.target.value })}
                          placeholder="1"
                          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                        />
                      </label>
                      <div className="col-span-2 flex items-end justify-end">
                        <button
                          type="button"
                          onClick={() => removeOffCutRow(row.id)}
                          className="rounded-lg p-2 text-red-500 hover:bg-red-500/10"
                          aria-label={t("forms.remove")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={addOffCutRow}
                className="btn-secondary flex items-center gap-1 text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("forms.addOffCutPiece")}
              </button>
            </div>
          </div>
        ) : null}

        {!isServiceCategorySelected ? (
          <label className="block text-xs font-semibold text-app">
            {t("forms.minStockThreshold")}
            <input
              type="number"
              value={form.min_stock}
              onChange={(e) => set({ min_stock: e.target.value })}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>
        ) : null}
      </div>

      <label className="block text-xs font-semibold text-app">
        {t("forms.extraInfo")}
        <textarea
          rows={3}
          value={form.extra_info}
          onChange={(e) => set({ extra_info: e.target.value })}
          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
        />
      </label>

      <div className="flex justify-end gap-2 border-t border-app pt-4">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border px-4 py-2 text-xs font-semibold text-app"
          >
              {t("common.cancel")}
          </button>
        )}
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-1 rounded-lg bg-[image:var(--app-gradient)] px-5 py-2 text-xs font-bold text-white disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {saving ? t("common.saving") : isEditMode ? t("common.edit") : t("forms.saveProduct")}
        </button>
      </div>
    </form>
    <ToastMessage message={toastMessage} variant={toastVariant} />
    </>
  );
}
