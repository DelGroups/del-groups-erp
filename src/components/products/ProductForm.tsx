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
import {
  formInputClass,
  formLabelClass,
  formRowClass,
  formSelectClass,
  formTextareaClass,
} from "@/components/ui/form-field-styles";
import { FormSectionCard } from "@/components/ui/form-section-card";
import { FormStickyActions } from "@/components/ui/form-sticky-actions";
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
  /** When true, renders inside a drawer without a fixed viewport footer. */
  embedded?: boolean;
}

export default function ProductForm({
  categories,
  warehouses,
  allProducts = [],
  initialProduct,
  onSuccess,
  onCancel,
  embedded = false,
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
      <form onSubmit={handleSubmit} className="w-full">
        {isServiceCategorySelected ? (
          <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            {t("forms.serviceProductHint")}
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6">
          <div className="space-y-4 lg:col-span-8">
            <FormSectionCard title={t("forms.sectionMainInfo")}>
              <div className={formRowClass}>
                <div>
                  <label className={formLabelClass}>{t("forms.productName")}</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => set({ name: e.target.value })}
                    className={formInputClass}
                  />
                </div>
                <div>
                  <label className={formLabelClass}>{t("forms.productCode")}</label>
                  <input
                    type="text"
                    value={form.code}
                    onChange={(e) => set({ code: e.target.value })}
                    placeholder={t("forms.autoGenerated")}
                    className={formInputClass}
                  />
                </div>
              </div>

              <div className={formRowClass}>
                <div>
                  <label className={formLabelClass}>{t("common.category")} *</label>
                  <select
                    required
                    value={form.category}
                    onChange={(e) => handleCategoryChange(e.target.value)}
                    className={formSelectClass}
                  >
                    <option value="">{t("common.select")}</option>
                    {parentCategories.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={formLabelClass}>{t("forms.subcategory")}</label>
                  <select
                    value={form.subcategory}
                    onChange={(e) => handleSubcategoryChange(e.target.value)}
                    className={formSelectClass}
                  >
                    <option value="">{t("forms.notSelected")}</option>
                    {availableSubcategories.map((c) => (
                      <option key={c.id} value={c.name}>
                        {getCategoryFullName(categories, c)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </FormSectionCard>

            {!isServiceCategorySelected ? (
              <FormSectionCard title={t("forms.sectionMetricsPricing")}>
                <div className="flex flex-wrap gap-3">
                  <label
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm transition-colors ${
                      form.is_dimensional
                        ? "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-100"
                        : "border-slate-200 bg-white text-slate-700 dark:border-app dark:bg-app-card dark:text-app"
                    } ${isComposite ? "cursor-not-allowed opacity-50" : ""}`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500/20"
                      checked={form.is_dimensional}
                      disabled={isComposite}
                      onChange={(event) => handleDimensionalToggle(event.target.checked)}
                    />
                    <span className="font-medium">{t("forms.isDimensionalProduct")}</span>
                  </label>

                  <label
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm transition-colors ${
                      isComposite
                        ? "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-100"
                        : "border-slate-200 bg-white text-slate-700 dark:border-app dark:bg-app-card dark:text-app"
                    } ${form.is_dimensional ? "cursor-not-allowed opacity-50" : ""}`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500/20"
                      checked={isComposite}
                      disabled={form.is_dimensional}
                      onChange={(e) => handleCompositeToggle(e.target.checked)}
                    />
                    <span className="font-medium">{t("products.bom.isComposite")}</span>
                  </label>
                </div>

                <div className={formRowClass}>
                  <div>
                    <label className={formLabelClass}>{t("forms.unitMeasure")}</label>
                    <select
                      value={
                        PRODUCT_MEASURE_UNITS.includes(
                          form.unit as (typeof PRODUCT_MEASURE_UNITS)[number]
                        )
                          ? form.unit
                          : "Ədəd"
                      }
                      onChange={(e) => handleUnitChange(e.target.value)}
                      className={formSelectClass}
                    >
                      {PRODUCT_MEASURE_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {measureUnitLabel(u)}
                        </option>
                      ))}
                    </select>
                  </div>
                  {showMetricFields ? (
                    <div>
                      <label className={formLabelClass}>{t("forms.standardBarLength")}</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.base_length || "4.0"}
                        onChange={(event) => set({ base_length: event.target.value })}
                        placeholder="4.0"
                        className={formInputClass}
                      />
                    </div>
                  ) : (
                    <div className="hidden sm:block" />
                  )}
                </div>

                {showMetricFields ? (
                  <div className={formRowClass}>
                    <div>
                      <label className={formLabelClass}>{t("forms.baseWidth")} (m)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.base_width}
                        onChange={(e) => set({ base_width: e.target.value })}
                        placeholder="0.60"
                        className={formInputClass}
                      />
                    </div>
                  </div>
                ) : null}

                <div className={formRowClass}>
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
                </div>
              </FormSectionCard>
            ) : null}

            {isComposite && !isServiceCategorySelected ? (
              <FormSectionCard title={t("products.bom.isComposite")}>
                <ProductBomBuilder
                  products={catalogProducts}
                  parentProductId={initialProduct?.id}
                  rows={bomRows}
                  onChange={setBomRows}
                />
                <p className="text-xs text-slate-700 dark:text-app-muted">{t("products.bom.stockHint")}</p>
              </FormSectionCard>
            ) : null}
          </div>

          <div className="space-y-4 lg:col-span-4">
            {!isServiceCategorySelected ? (
              <>
                <FormSectionCard title={t("forms.sectionBarcodeRules")}>
                  <div>
                    <label className={formLabelClass}>{t("forms.barcode")}</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={form.barcode}
                        onChange={(e) => set({ barcode: e.target.value })}
                        placeholder={t("forms.autoGenerated")}
                        className={`${formInputClass} font-mono`}
                      />
                      <button
                        type="button"
                        onClick={() => set({ barcode: generateProductBarcode() })}
                        className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-app dark:bg-app-card dark:text-app dark:hover:bg-app-card-hover"
                      >
                        <Barcode className="h-3.5 w-3.5" />
                        {t("inventory.generateBarcode")}
                      </button>
                    </div>
                  </div>

                  {form.barcode.trim() ? (
                    <div className="flex flex-col items-center gap-5 rounded-lg border border-slate-100 bg-slate-50/80 p-5 dark:border-app dark:bg-app-card-hover/50">
                      <div className="text-center">
                        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-700 dark:text-app-muted">
                          {t("forms.barcodePreview")}
                        </p>
                        <BarcodeDisplay value={form.barcode} />
                      </div>
                      <div className="text-center">
                        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-700 dark:text-app-muted">
                          QR
                        </p>
                        <QrCodeImage value={form.barcode} size={96} />
                      </div>
                    </div>
                  ) : null}
                </FormSectionCard>

                <FormSectionCard title={t("forms.sectionExtraSettings")}>
                  <div>
                    <label className={formLabelClass}>{t("forms.minStockThreshold")}</label>
                    <input
                      type="number"
                      value={form.min_stock}
                      onChange={(e) => set({ min_stock: e.target.value })}
                      className={formInputClass}
                    />
                  </div>
                  <div>
                    <label className={formLabelClass}>{t("forms.extraInfo")}</label>
                    <textarea
                      rows={4}
                      value={form.extra_info}
                      onChange={(e) => set({ extra_info: e.target.value })}
                      className={formTextareaClass}
                    />
                  </div>
                </FormSectionCard>
              </>
            ) : null}
          </div>
        </div>

        {embedded ? (
          <div className="mt-6 flex justify-end gap-2 border-t border-app pt-4">
            {onCancel ? (
              <button
                type="button"
                onClick={onCancel}
                className="h-9 rounded-lg border border-app bg-app-card px-4 text-xs font-semibold text-app transition-colors hover:bg-app-card-hover"
              >
                {t("common.cancel")}
              </button>
            ) : null}
            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-[image:var(--app-gradient)] px-5 text-xs font-semibold text-white transition-opacity disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? t("common.saving") : isEditMode ? t("common.edit") : t("forms.saveProduct")}
            </button>
          </div>
        ) : (
          <FormStickyActions>
            {onCancel ? (
              <button
                type="button"
                onClick={onCancel}
                className="h-9 rounded-lg border border-app bg-app-card px-4 text-xs font-semibold text-app transition-colors hover:bg-app-card-hover"
              >
                {t("common.cancel")}
              </button>
            ) : null}
            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-[image:var(--app-gradient)] px-5 text-xs font-semibold text-white transition-opacity disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? t("common.saving") : isEditMode ? t("common.edit") : t("forms.saveProduct")}
            </button>
          </FormStickyActions>
        )}
      </form>
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </>
  );
}
