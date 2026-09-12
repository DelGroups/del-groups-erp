"use client";

import React, { useEffect, useState } from "react";
import { Barcode, Save } from "lucide-react";
import type { Category, Product, ProductInsert, Warehouse } from "@/types/database.types";
import BarcodeDisplay from "@/components/products/BarcodeDisplay";
import QrCodeImage from "@/components/products/QrCodeImage";
import { createProduct, getCategoryFullName, updateProduct } from "@/lib/products/api";
import { generateProductBarcode } from "@/lib/products/generateBarcode";
import { matchesServiceCategoryName } from "@/lib/products/serviceCategory";
import { useI18n } from "@/i18n/I18nProvider";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import UnitAwarePriceInput from "@/components/products/UnitAwarePriceInput";
import ProductBomBuilder, { type BomBuilderRow } from "@/components/products/ProductBomBuilder";
import { parseMetricBarLengthM } from "@/lib/polywood/metricPriceConversion";
import {
  defaultPriceEntryUnitForMeasure,
  isMetricMeasureUnit,
  measureUnitLabel,
  PRODUCT_MEASURE_UNITS,
  type PriceEntryUnit,
} from "@/lib/products/productPriceUnits";
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
  const initialMeasureUnit = initialProduct?.unit || "Ədəd";
  const [buyPriceUnit, setBuyPriceUnit] = useState<PriceEntryUnit>(
    defaultPriceEntryUnitForMeasure(initialMeasureUnit)
  );
  const [sellPriceUnit, setSellPriceUnit] = useState<PriceEntryUnit>(
    defaultPriceEntryUnitForMeasure(initialMeasureUnit)
  );
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
    buy_price_cut: String(initialProduct?.buy_price_cut ?? 0),
    sell_price: String(initialProduct?.sell_price ?? 0),
    sell_price_cut: String(initialProduct?.sell_price_cut ?? 0),
    stock: String(initialProduct?.stock ?? 0),
    min_stock: String(initialProduct?.min_stock ?? 5),
    barcode: initialProduct?.barcode || (!initialProduct ? generateProductBarcode() : ""),
    extra_info: initialProduct?.extra_info || "",
    is_dimensional: Boolean(initialProduct?.is_dimensional),
    is_composite: Boolean(initialProduct?.is_composite),
    base_length: String(initialProduct?.base_length ?? initialProduct?.full_sheet_length_m ?? "4.0"),
    base_width: String(initialProduct?.base_width ?? ""),
  });

  const set = (patch: Partial<typeof form>) => setForm((prev) => ({ ...prev, ...patch }));

  const parentCategories = categories.filter((cat) => !cat.parent_id);
  const selectedParent = categories.find((cat) => cat.name === form.category && !cat.parent_id);
  const availableSubcategories = selectedParent
    ? categories.filter((cat) => cat.parent_id === selectedParent.id)
    : [];
  const isServiceCategorySelected =
    matchesServiceCategoryName(form.category) || matchesServiceCategoryName(form.subcategory);

  const metricMeasureUnit = isMetricMeasureUnit(form.unit);
  const showMetricFields =
    (form.is_dimensional || metricMeasureUnit) && !isServiceCategorySelected && !isComposite;
  const standardBarLengthM = parseMetricBarLengthM(form.base_length);
  const standardWidthM = parseFloat(form.base_width) || 0;
  const priceStorageMode = showMetricFields ? "per_meter" : "per_piece";

  const handleUnitChange = (unit: string) => {
    const metric = isMetricMeasureUnit(unit);
    const nextEntryUnit = defaultPriceEntryUnitForMeasure(unit);
    setBuyPriceUnit(nextEntryUnit);
    setSellPriceUnit(nextEntryUnit);
    set({
      unit,
      is_dimensional: metric,
      base_length:
        metric && !(parseFloat(form.base_length) > 0) ? "4.0" : form.base_length,
      base_width:
        unit === "Kvadrat Metr" && !(parseFloat(form.base_width) > 0) ? "0.60" : form.base_width,
    });
  };

  const handleDimensionalToggle = (checked: boolean) => {
    const nextUnit = checked
      ? form.unit === "Ədəd"
        ? "Metr"
        : form.unit
      : metricMeasureUnit
        ? "Ədəd"
        : form.unit;
    const nextEntryUnit = defaultPriceEntryUnitForMeasure(nextUnit);
    setBuyPriceUnit(nextEntryUnit);
    setSellPriceUnit(nextEntryUnit);
    set({
      is_dimensional: checked,
      unit: nextUnit,
      base_length:
        checked && !(parseFloat(form.base_length) > 0) ? "4.0" : form.base_length,
    });
  };

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
    if (!checked) {
      setBomRows([]);
    }
  };

  const inputClass = "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-app";
  const columnClass = "flex min-w-0 flex-col gap-6";

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
      buy_price_cut: showMetricFields ? parseFloat(form.buy_price) || 0 : 0,
      sell_price: parseFloat(form.sell_price) || 0,
      sell_price_cut: showMetricFields ? parseFloat(form.sell_price) || 0 : 0,
      stock: isServiceCategorySelected || isComposite || !isEditMode ? 0 : parseFloat(form.stock) || 0,
      min_stock: isServiceCategorySelected ? 0 : parseFloat(form.min_stock) || 0,
      barcode: form.barcode || null,
      qr_code: form.barcode || null,
      extra_info: form.extra_info || null,
      is_dimensional:
        isServiceCategorySelected || isComposite
          ? false
          : form.is_dimensional || metricMeasureUnit,
      is_composite: isServiceCategorySelected ? false : isComposite,
      is_service: isServiceCategorySelected,
      base_length:
        !isServiceCategorySelected && (form.is_dimensional || metricMeasureUnit)
          ? parseFloat(form.base_length) || null
          : null,
      base_width:
        !isServiceCategorySelected && (form.is_dimensional || form.unit === "Kvadrat Metr")
          ? parseFloat(form.base_width) || null
          : null,
    };

    const result = isEditMode && initialProduct
      ? await updateProduct(initialProduct.id, payload)
      : await createProduct(payload);
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
      <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-app dark:bg-app-card">
        <form onSubmit={handleSubmit} className="w-full space-y-6">
          {isServiceCategorySelected ? (
            <p className="rounded-lg border border-app bg-app-card-hover px-3 py-2 text-xs text-app-muted">
              {t("forms.serviceProductHint")}
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {/* Column 1 — identity */}
            <div className={columnClass}>
              <label className="block text-xs font-semibold text-app">
                {t("forms.productCode")}
                <input
                  type="text"
                  value={form.code}
                  onChange={(e) => set({ code: e.target.value })}
                  placeholder={t("forms.autoGenerated")}
                  className={inputClass}
                />
              </label>

              <label className="block text-xs font-semibold text-app">
                {t("forms.productName")}
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => set({ name: e.target.value })}
                  className={inputClass}
                />
              </label>

              <label className="block text-xs font-semibold text-app">
                {t("common.category")} *
                <select
                  required
                  value={form.category}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  className="app-input mt-1 w-full text-sm"
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
                  className="app-input mt-1 w-full text-sm"
                >
                  <option value="">{t("forms.notSelected")}</option>
                  {availableSubcategories.map((c) => (
                    <option key={c.id} value={c.name}>
                      {getCategoryFullName(categories, c)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Column 2 — metrics */}
            <div className={columnClass}>
              {!isServiceCategorySelected ? (
                <>
                  <label className="flex items-center gap-2 text-xs font-semibold text-app">
                    <input
                      type="checkbox"
                      checked={form.is_dimensional}
                      disabled={isComposite}
                      onChange={(event) => handleDimensionalToggle(event.target.checked)}
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

                  {showMetricFields ? (
                    <>
                      <label className="block text-xs font-semibold text-app">
                        {t("forms.standardBarLength")}
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={form.base_length || "4.0"}
                          onChange={(event) => set({ base_length: event.target.value })}
                          placeholder="4.0"
                          className={inputClass}
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
                          className={inputClass}
                        />
                      </label>
                    </>
                  ) : null}

                  <label className="block text-xs font-semibold text-app">
                    {t("forms.unitMeasure")}
                    <select
                      value={
                        PRODUCT_MEASURE_UNITS.includes(form.unit as (typeof PRODUCT_MEASURE_UNITS)[number])
                          ? form.unit
                          : "Ədəd"
                      }
                      onChange={(e) => handleUnitChange(e.target.value)}
                      className="app-input mt-1 w-full text-sm"
                    >
                      {PRODUCT_MEASURE_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {measureUnitLabel(u)}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}
            </div>

            {/* Column 3 — pricing, barcode, rules */}
            <div className={columnClass}>
              {!isServiceCategorySelected ? (
                <>
                  <UnitAwarePriceInput
                    label={t("forms.buyPrice")}
                    storedValue={form.buy_price}
                    entryUnit={buyPriceUnit}
                    onEntryUnitChange={setBuyPriceUnit}
                    onStoredValueChange={(value) => set({ buy_price: value })}
                    barLengthM={standardBarLengthM}
                    widthM={standardWidthM}
                    storageMode={priceStorageMode}
                  />
                  <UnitAwarePriceInput
                    label={t("forms.sellPrice")}
                    storedValue={form.sell_price}
                    entryUnit={sellPriceUnit}
                    onEntryUnitChange={setSellPriceUnit}
                    onStoredValueChange={(value) => set({ sell_price: value })}
                    barLengthM={standardBarLengthM}
                    widthM={standardWidthM}
                    storageMode={priceStorageMode}
                  />

                  <div className="block text-xs font-semibold text-app">
                    <label>
                      {t("forms.barcode")}
                      <div className="mt-1 flex gap-2">
                        <input
                          type="text"
                          value={form.barcode}
                          onChange={(e) => set({ barcode: e.target.value })}
                          placeholder={t("forms.autoGenerated")}
                          className={`${inputClass} font-mono`}
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
                    {form.barcode.trim() ? (
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
                    ) : null}
                  </div>

                  <label className="block text-xs font-semibold text-app">
                    {t("forms.minStockThreshold")}
                    <input
                      type="number"
                      value={form.min_stock}
                      onChange={(e) => set({ min_stock: e.target.value })}
                      className={inputClass}
                    />
                  </label>
                </>
              ) : null}
            </div>
          </div>

          {isComposite && !isServiceCategorySelected ? (
            <div className="border-t border-slate-200 pt-6 dark:border-app">
              <ProductBomBuilder
                products={catalogProducts}
                parentProductId={initialProduct?.id}
                rows={bomRows}
                onChange={setBomRows}
              />
              <p className="mt-2 text-xs text-app-muted">{t("products.bom.stockHint")}</p>
            </div>
          ) : null}

          <label className="block text-xs font-semibold text-app">
            {t("forms.extraInfo")}
            <textarea
              rows={3}
              value={form.extra_info}
              onChange={(e) => set({ extra_info: e.target.value })}
              className={inputClass}
            />
          </label>

          <div className="flex justify-end gap-2 border-t border-slate-200 pt-6 dark:border-app">
            {onCancel ? (
              <button
                type="button"
                onClick={onCancel}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 dark:border-app dark:bg-app-card dark:text-app"
              >
                {t("common.cancel")}
              </button>
            ) : null}
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
      </div>
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </>
  );
}
