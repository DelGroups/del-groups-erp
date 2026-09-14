"use client";

import React, { useEffect, useState } from "react";
import { Save } from "lucide-react";
import type { Category, Product, ProductInsert, Warehouse } from "@/types/database.types";
import DualUnitPriceGroup from "@/components/products/DualUnitPriceGroup";
import PriceInputWithBadge from "@/components/products/PriceInputWithBadge";
import ProductBarcodePanel, {
  type FormLabelSizeId,
} from "@/components/products/ProductBarcodePanel";
import { createProduct, getCategoryFullName, updateProduct } from "@/lib/products/api";
import {
  generateProductBarcode,
  type ProductBarcodeFormat,
} from "@/lib/products/generateBarcode";
import { matchesServiceCategoryName } from "@/lib/products/serviceCategory";
import { useI18n } from "@/i18n/I18nProvider";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import ProductBomBuilder, { type BomBuilderRow } from "@/components/products/ProductBomBuilder";
import {
  formInputClass,
  formRowClass,
  formSelectClass,
  formTextareaClass,
} from "@/components/ui/form-field-styles";
import Button from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { FormStickyActions } from "@/components/ui/form-sticky-actions";
import { parseMetricBarLengthM } from "@/lib/polywood/metricPriceConversion";
import {
  isMetricMeasureUnit,
  measureUnitLabel,
  PRODUCT_MEASURE_UNITS,
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
  /** Polished centered layout for the dedicated create page. */
  layout?: "default" | "create-page";
}

function ProductFormSection({
  title,
  children,
  compact = false,
}: {
  title: string;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <Card padding={false}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className={compact ? "space-y-3" : "space-y-4"}>{children}</CardContent>
    </Card>
  );
}

export default function ProductForm({
  categories,
  warehouses,
  allProducts = [],
  initialProduct,
  onSuccess,
  onCancel,
  embedded = false,
  layout = "default",
}: ProductFormProps) {
  const isCreatePage = layout === "create-page" && !embedded;
  const rowClass = isCreatePage ? "grid grid-cols-1 gap-4 sm:grid-cols-2" : formRowClass;
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
  const [barcodeFormat, setBarcodeFormat] = useState<ProductBarcodeFormat>("EAN13");
  const [labelSize, setLabelSize] = useState<FormLabelSizeId>("50x30mm");
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
    set({
      unit,
      is_dimensional: form.is_dimensional || metric,
      base_length:
        (form.is_dimensional || metric) && !(parseFloat(form.base_length) > 0)
          ? "4.0"
          : form.base_length,
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
    set({
      is_dimensional: checked,
      unit: nextUnit,
      base_length:
        checked && !(parseFloat(form.base_length) > 0) ? "4.0" : form.base_length,
      base_width:
        checked && nextUnit === "Kvadrat Metr" && !(parseFloat(form.base_width) > 0)
          ? "0.60"
          : form.base_width,
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

  const formActions = (
    <>
      {onCancel ? (
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      ) : null}
      <Button type="submit" variant="default" loading={saving}>
        <Save className="h-4 w-4" />
        {saving ? t("common.saving") : isEditMode ? t("common.edit") : t("forms.saveProduct")}
      </Button>
    </>
  );

  return (
    <>
      <form onSubmit={handleSubmit} className="w-full pb-4">
        {isServiceCategorySelected ? (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            {t("forms.serviceProductHint")}
          </p>
        ) : null}

        <div className="grid w-full grid-cols-1 items-start gap-6 lg:grid-cols-12">
          <div className="flex w-full flex-col gap-6 lg:col-span-8">
            <ProductFormSection title={t("forms.sectionMainInfo")}>
              <div className={rowClass}>
                <FormField label={t("forms.productName")} required>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => set({ name: e.target.value })}
                    className={formInputClass}
                  />
                </FormField>
                <FormField label={t("forms.productCode")}>
                  <input
                    type="text"
                    value={form.code}
                    onChange={(e) => set({ code: e.target.value })}
                    placeholder={t("forms.autoGenerated")}
                    className={formInputClass}
                  />
                </FormField>
              </div>

              <div className={rowClass}>
                <FormField label={t("common.category")} required>
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
                </FormField>
                <FormField label={t("forms.subcategory")}>
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
                </FormField>
              </div>
            </ProductFormSection>

            {!isServiceCategorySelected ? (
              <ProductFormSection title={t("forms.sectionMetricsPricing")} compact>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label
                    className={`flex w-full cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm transition-colors ${
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
                    className={`flex w-full cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm transition-colors ${
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

                <div
                  className={
                    showMetricFields
                      ? "grid grid-cols-2 gap-4"
                      : "grid grid-cols-1 gap-4 sm:grid-cols-2"
                  }
                >
                  <FormField label={t("forms.unitMeasure")}>
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
                  </FormField>
                  {showMetricFields ? (
                    <>
                      <FormField label={t("forms.standardBarLength")}>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={form.base_length || "4.0"}
                          onChange={(event) => set({ base_length: event.target.value })}
                          placeholder={t("forms.lengthPlaceholder")}
                          className={formInputClass}
                        />
                      </FormField>
                      <FormField label={`${t("forms.baseWidth")} (m)`}>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={form.base_width}
                          onChange={(e) => set({ base_width: e.target.value })}
                          placeholder={t("forms.widthPlaceholder")}
                          className={formInputClass}
                        />
                      </FormField>
                    </>
                  ) : null}
                </div>

                {showMetricFields ? (
                  <DualUnitPriceGroup
                    buyStored={form.buy_price}
                    sellStored={form.sell_price}
                    onBuyChange={(value) => set({ buy_price: value })}
                    onSellChange={(value) => set({ sell_price: value })}
                    barLengthM={standardBarLengthM}
                    widthM={standardWidthM}
                    storageMode={priceStorageMode}
                    measureUnit={form.unit}
                  />
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    <PriceInputWithBadge
                      label={t("forms.buyPrice")}
                      value={form.buy_price}
                      onChange={(value) => set({ buy_price: value })}
                      badge={t("forms.badgeAznPiece")}
                      placeholder={t("forms.sheetPricePlaceholder")}
                    />
                    <PriceInputWithBadge
                      label={t("forms.sellPrice")}
                      value={form.sell_price}
                      onChange={(value) => set({ sell_price: value })}
                      badge={t("forms.badgeAznPiece")}
                      placeholder={t("forms.sellSheetPricePlaceholder")}
                    />
                  </div>
                )}
              </ProductFormSection>
            ) : null}

            {isComposite && !isServiceCategorySelected ? (
              <ProductFormSection title={t("products.bom.isComposite")}>
                <ProductBomBuilder
                  products={catalogProducts}
                  parentProductId={initialProduct?.id}
                  rows={bomRows}
                  onChange={setBomRows}
                />
                <p className="text-xs text-slate-700 dark:text-app-muted">{t("products.bom.stockHint")}</p>
              </ProductFormSection>
            ) : null}
          </div>

          <div className="flex w-full flex-col gap-6 lg:col-span-4">
            {!isServiceCategorySelected ? (
              <>
                <ProductFormSection title={t("forms.sectionBarcodeRules")}>
                  <ProductBarcodePanel
                    value={form.barcode}
                    onChange={(barcode) => set({ barcode })}
                    barcodeFormat={barcodeFormat}
                    onBarcodeFormatChange={setBarcodeFormat}
                    labelSize={labelSize}
                    onLabelSizeChange={setLabelSize}
                  />
                </ProductFormSection>

                <ProductFormSection title={t("forms.sectionExtraSettings")}>
                  <div className="space-y-4">
                    <FormField label={t("forms.minStockThreshold")}>
                      <input
                        type="number"
                        value={form.min_stock}
                        onChange={(e) => set({ min_stock: e.target.value })}
                        className={formInputClass}
                      />
                    </FormField>
                    <FormField label={t("forms.extraInfo")}>
                      <textarea
                        rows={4}
                        value={form.extra_info}
                        onChange={(e) => set({ extra_info: e.target.value })}
                        className={formTextareaClass}
                      />
                    </FormField>
                  </div>
                </ProductFormSection>
              </>
            ) : null}
          </div>
        </div>

        {embedded ? (
          <div className="mt-6 flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
            {formActions}
          </div>
        ) : (
          <FormStickyActions fullWidth={isCreatePage}>{formActions}</FormStickyActions>
        )}
      </form>
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </>
  );
}
