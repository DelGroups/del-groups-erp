"use client";

import React, { useEffect, useRef, useState } from "react";
import { Copy, Save } from "lucide-react";
import type { Category, Product, ProductInsert, Warehouse } from "@/types/database.types";
import ProductPriceRowsEditor from "@/components/products/ProductPriceRowsEditor";
import {
  buildExtraInfoWithPriceMeta,
  extractUserNotesFromExtraInfo,
  parsePriceRowsFromProduct,
  rowsToDbColumns,
  rowsToMeta,
  type ProductPriceRowsState,
} from "@/lib/products/productPriceRows";
import ProductBarcodePanel from "@/components/products/ProductBarcodePanel";
import ProductImageField from "@/components/products/ProductImageField";
import { getCategoryFullName, updateProduct } from "@/lib/products/api";
import { FetchTimeoutError, fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { PRODUCT_CREATE_REQUEST_TIMEOUT_MS } from "@/lib/products/productCreateConstants";
import { isBarcodeModuleEnabled } from "@/lib/features/barcodeModule";
import { matchesServiceCategoryName } from "@/lib/products/serviceCategory";
import { useI18n } from "@/i18n/I18nProvider";
import { numberToFieldValue, parseFieldNumber, parseFieldOptionalNumber } from "@/lib/forms/numericField";
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
import Panel from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { FormActionsBar } from "@/components/ui/form-sticky-actions";
import {
  isMetricMeasureUnit,
  measureUnitLabel,
  PRODUCT_MEASURE_UNITS,
} from "@/lib/products/productPriceUnits";
import { fetchProductBomAction, saveProductBomAction } from "@/lib/actions/productBom";
import { fetchProductsCatalog } from "@/lib/products/api";
import { useInvalidateProductsCatalog } from "@/hooks/useProductsCatalog";

interface ProductFormProps {
  categories: Category[];
  warehouses: Warehouse[];
  allProducts?: Product[];
  initialProduct?: Product | null;
  /** When duplicating, load BOM from the source product id while creating a new row. */
  cloneSourceId?: string | null;
  isClone?: boolean;
  onSuccess?: () => void;
  onCancel?: () => void;
  /** When true, renders inside a drawer without a fixed viewport footer. */
  embedded?: boolean;
  /** Polished centered layout for the dedicated create page. */
  layout?: "default" | "create-page";
  /** Links submit button in an external drawer footer. */
  formId?: string;
  onSavingChange?: (saving: boolean) => void;
}

function ProductFormSection({
  title,
  children,
  compact = false,
  embedded = false,
}: {
  title: string;
  children: React.ReactNode;
  compact?: boolean;
  embedded?: boolean;
}) {
  const stackClass = compact ? "space-y-3" : "space-y-4";

  if (embedded) {
    return (
      <Panel title={title} className="mb-0 shadow-none">
        <div className={stackClass}>{children}</div>
      </Panel>
    );
  }

  return (
    <Card padding={false}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className={stackClass}>{children}</CardContent>
    </Card>
  );
}

function toDateFieldValue(value?: string | null): string {
  if (!value) return "";
  return value.slice(0, 10);
}

function toggleOptionClass(active: boolean, disabled?: boolean) {
  return cn(
    "flex w-full cursor-pointer items-center gap-3 rounded-[var(--erp-radius-md)] border px-3 py-2.5 text-sm transition-colors",
    active
      ? "border-[color:var(--erp-color-primary)]/35 bg-[color:var(--erp-color-primary)]/8 text-[color:var(--erp-text-main)]"
      : "border-[color:var(--erp-border-default)] bg-[color:var(--erp-bg-input)] text-[color:var(--erp-text-main)]",
    disabled && "cursor-not-allowed opacity-50"
  );
}

export default function ProductForm({
  categories,
  warehouses,
  allProducts = [],
  initialProduct,
  cloneSourceId = null,
  isClone = false,
  onSuccess,
  onCancel,
  embedded = false,
  layout = "default",
  formId,
  onSavingChange,
}: ProductFormProps) {
  const barcodeModuleEnabled = isBarcodeModuleEnabled();
  const isCreatePage = layout === "create-page" && !embedded;
  const isDrawerLayout = embedded;
  const rowClass = isCreatePage ? "grid grid-cols-1 gap-4 sm:grid-cols-2" : formRowClass;
  const metaRowClass = isCreatePage
    ? "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
    : rowClass;
  const sectionStackClass = isCreatePage ? "gap-4" : "gap-6";
  const showDrawerFooter = embedded && Boolean(formId);
  const { t } = useI18n();
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const invalidateProductsCatalog = useInvalidateProductsCatalog();
  const isEditMode = Boolean(initialProduct?.id) && !isClone;

  const categoryByName = (name?: string | null) =>
    categories.find((cat) => cat.name === (name || "").trim()) || null;
  const initialCategory = categoryByName(initialProduct?.category) || null;
  const resolvedParent = initialCategory?.parent_id
    ? categories.find((cat) => cat.id === initialCategory.parent_id) || null
    : initialCategory;

  const [saving, setSaving] = useState(false);
  const submitInFlightRef = useRef(false);
  const nameFieldRef = useRef<HTMLInputElement>(null);
  const [catalogProducts, setCatalogProducts] = useState<Product[]>(allProducts);
  const [isComposite, setIsComposite] = useState(Boolean(initialProduct?.is_composite));
  const [bomRows, setBomRows] = useState<BomBuilderRow[]>([]);
  const [priceRows, setPriceRows] = useState<ProductPriceRowsState>(() =>
    parsePriceRowsFromProduct(initialProduct)
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
    stock: numberToFieldValue(initialProduct?.stock),
    min_stock: numberToFieldValue(initialProduct?.min_stock),
    barcode: initialProduct?.barcode || "",
    image_url: initialProduct?.image_url || "",
    extra_info: extractUserNotesFromExtraInfo(initialProduct?.extra_info),
    is_dimensional: Boolean(initialProduct?.is_dimensional),
    is_composite: Boolean(initialProduct?.is_composite),
    base_length: numberToFieldValue(
      initialProduct?.base_length ?? initialProduct?.full_sheet_length_m ?? null
    ),
    base_width: numberToFieldValue(initialProduct?.base_width),
    brand: initialProduct?.brand || "",
    country_of_origin: initialProduct?.country_of_origin || "",
    mfg_date: toDateFieldValue(initialProduct?.mfg_date),
    exp_date: toDateFieldValue(initialProduct?.exp_date),
    price_wholesale: numberToFieldValue(initialProduct?.price_wholesale),
    price_distributor: numberToFieldValue(initialProduct?.price_distributor),
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
  const showDimensionFields = !isServiceCategorySelected && !isComposite;
  const showPriceRows = showDimensionFields;

  const handleUnitChange = (unit: string) => {
    const metric = isMetricMeasureUnit(unit);
    set({
      unit,
      is_dimensional: form.is_dimensional || metric,
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
    });
  };

  const handleCategoryChange = (category: string) => {
    const serviceCategory = matchesServiceCategoryName(category);
    set({
      category,
      subcategory: "",
      is_dimensional: serviceCategory ? false : form.is_dimensional,
      unit: serviceCategory ? "Xidmət" : form.unit,
      stock: serviceCategory ? "" : form.stock,
      min_stock: serviceCategory ? "" : form.min_stock,
    });
  };

  const handleSubcategoryChange = (subcategory: string) => {
    const serviceCategory = matchesServiceCategoryName(subcategory);
    set({
      subcategory,
      is_dimensional: serviceCategory ? false : form.is_dimensional,
      is_composite: serviceCategory ? false : form.is_composite,
      unit: serviceCategory ? "Xidmət" : form.unit,
      stock: serviceCategory ? "" : form.stock,
      min_stock: serviceCategory ? "" : form.min_stock,
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
      stock: checked ? "" : form.stock,
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
    onSavingChange?.(saving);
  }, [saving, onSavingChange]);

  useEffect(() => {
    const bomSourceId = isClone ? cloneSourceId : initialProduct?.id;
    if (!bomSourceId || !initialProduct?.is_composite) return;
    void fetchProductBomAction(bomSourceId).then((result) => {
      if (!result.success) return;
      setBomRows(
        result.rows.map((row) => ({
          id: row.id,
          componentProductId: row.componentProductId,
          quantity: String(row.quantity),
        }))
      );
    });
  }, [cloneSourceId, initialProduct?.id, initialProduct?.is_composite, isClone]);

  type SubmitAction = "SAVE_ONLY" | "SAVE_AND_DUPLICATE";

  // Clears only the fields that must be unique per product (name, barcode/QR,
  // image, and the manually-entered code, which is DB-unique-constrained),
  // keeping category, prices, dimensions and every other repetitive field so
  // an operator can rapid-fire near-identical variants (same product,
  // different size/color) without re-entering the shared data each time.
  const resetForDuplicate = () => {
    setForm((prev) => ({
      ...prev,
      code: "",
      name: "",
      barcode: "",
      image_url: "",
    }));
    nameFieldRef.current?.focus();
  };

  const submitProduct = async (action: SubmitAction) => {
    if (submitInFlightRef.current || saving) return;

    if (!form.name.trim()) {
      showError(t("forms.enterProductName"));
      return;
    }

    if (isComposite && !isServiceCategorySelected) {
      const validBomRows = bomRows.filter(
        (row) => row.componentProductId && parseFieldNumber(row.quantity, 0) > 0
      );
      if (validBomRows.length === 0) {
        showError(t("products.bom.required"));
        return;
      }
    }

    submitInFlightRef.current = true;
    setSaving(true);
    const selectedCategoryEntity =
      categories.find((cat) => cat.name === form.subcategory && cat.parent_id) ||
      categories.find((cat) => cat.name === form.category && !cat.parent_id) ||
      null;

    const priceColumns = rowsToDbColumns(priceRows);

    const payload: ProductInsert = {
      code: form.code,
      name: form.name,
      category: form.category || "Ümumi",
      subcategory: form.subcategory || null,
      category_id: selectedCategoryEntity?.id || null,
      unit: form.unit,
      buy_price: priceColumns.buy_price,
      sell_price: priceColumns.sell_price,
      stock:
        isServiceCategorySelected || isComposite || !isEditMode
          ? 0
          : parseFieldNumber(form.stock, 0),
      min_stock: isServiceCategorySelected ? 0 : parseFieldNumber(form.min_stock, 0),
      barcode: barcodeModuleEnabled
        ? form.barcode || null
        : initialProduct?.barcode ?? null,
      qr_code: barcodeModuleEnabled
        ? form.barcode || null
        : initialProduct?.qr_code ?? null,
      image_url: form.image_url?.trim() || null,
      extra_info: buildExtraInfoWithPriceMeta(form.extra_info, rowsToMeta(priceRows)),
      is_dimensional:
        isServiceCategorySelected || isComposite
          ? false
          : form.is_dimensional || metricMeasureUnit,
      is_composite: isServiceCategorySelected ? false : isComposite,
      is_service: isServiceCategorySelected,
      base_length:
        !isServiceCategorySelected && (form.is_dimensional || metricMeasureUnit)
          ? parseFieldOptionalNumber(form.base_length)
          : null,
      base_width:
        !isServiceCategorySelected && (form.is_dimensional || form.unit === "Kvadrat Metr")
          ? parseFieldOptionalNumber(form.base_width)
          : null,
      brand: form.brand.trim() || null,
      country_of_origin: form.country_of_origin.trim() || null,
      mfg_date: form.mfg_date || null,
      exp_date: form.exp_date || null,
      price_wholesale: isServiceCategorySelected ? null : parseFieldOptionalNumber(form.price_wholesale),
      price_distributor: isServiceCategorySelected ? null : parseFieldOptionalNumber(form.price_distributor),
    };

    try {
      if (isEditMode && initialProduct) {
        const result = await updateProduct(initialProduct.id, payload);
        if (!result.ok) {
          showError(
            t("common.errorOccurred", {
              message: formatRpcError(result.error, t) ?? t("common.error"),
            })
          );
          return;
        }

        const bomPayload = bomRows
          .filter((row) => row.componentProductId && (parseFloat(row.quantity) || 0) > 0)
          .map((row) => ({
            componentProductId: row.componentProductId,
            quantity: parseFieldNumber(row.quantity, 1),
          }));

        const bomResult = await saveProductBomAction(
          initialProduct.id,
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

        showSuccess(t("common.success"));
        await invalidateProductsCatalog();
        onSuccess?.();
        return;
      }

      const bomPayload = bomRows
        .filter((row) => row.componentProductId && (parseFloat(row.quantity) || 0) > 0)
        .map((row) => ({
          componentProductId: row.componentProductId,
          quantity: parseFloat(row.quantity) || 1,
        }));

      const response = await fetchWithTimeout(
        "/api/products",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            product: payload,
            bomRows: bomPayload,
            isComposite: isComposite && !isServiceCategorySelected,
          }),
        },
        PRODUCT_CREATE_REQUEST_TIMEOUT_MS
      );

      const body = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        errorCode?: string;
        data?: Product;
      };

      if (!response.ok || !body.success) {
        const message =
          body.errorCode === "duplicate"
            ? t("forms.productDuplicate")
            : formatRpcError(body.error, t) ?? t("common.error");
        showError(t("common.errorOccurred", { message }));
        return;
      }

      showSuccess(t("forms.productCreated"));
      await invalidateProductsCatalog();
      if (action === "SAVE_AND_DUPLICATE") {
        resetForDuplicate();
      } else {
        onSuccess?.();
      }
    } catch (error) {
      if (error instanceof FetchTimeoutError) {
        showError(t("forms.productSaveTimeout"));
        return;
      }
      showError(
        t("common.errorOccurred", {
          message: error instanceof Error ? error.message : t("common.error"),
        })
      );
    } finally {
      setSaving(false);
      submitInFlightRef.current = false;
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitProduct("SAVE_ONLY");
  };

  const formActions = (
    <>
      {onCancel ? (
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      ) : null}
      {!isEditMode ? (
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={() => void submitProduct("SAVE_AND_DUPLICATE")}
        >
          <Copy className="h-4 w-4" />
          {t("forms.saveAndDuplicate")}
        </Button>
      ) : null}
      <Button type="submit" variant="default" loading={saving} disabled={saving}>
        <Save className="h-4 w-4" />
        {saving ? t("common.saving") : isEditMode ? t("common.edit") : t("forms.saveProduct")}
      </Button>
    </>
  );

  return (
    <>
      <form id={formId} onSubmit={handleSubmit} className="w-full">
        {!showDrawerFooter ? (
          <FormActionsBar fullWidth={isCreatePage} className={isCreatePage ? "mb-4" : "mb-6"}>
            {formActions}
          </FormActionsBar>
        ) : null}

        <fieldset disabled={saving} className="contents">
        {isServiceCategorySelected ? (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            {t("forms.serviceProductHint")}
          </p>
        ) : null}

        <div
          className={
            isDrawerLayout
              ? "flex w-full flex-col gap-5"
              : `grid w-full grid-cols-1 items-start ${sectionStackClass} lg:grid-cols-12`
          }
        >
          <div
            className={
              isDrawerLayout
                ? "flex w-full flex-col gap-5"
                : `flex w-full flex-col ${sectionStackClass} ${
                    barcodeModuleEnabled && !isServiceCategorySelected ? "lg:col-span-8" : "lg:col-span-12"
                  }`
            }
          >
            <ProductFormSection title={t("forms.sectionMainInfo")} embedded={isDrawerLayout}>
              <div
                className={
                  isDrawerLayout
                    ? "grid grid-cols-1 gap-4 sm:grid-cols-[5rem_minmax(0,1fr)]"
                    : "flex items-start gap-4"
                }
              >
                <ProductImageField
                  value={form.image_url || null}
                  onChange={(imageUrl) => set({ image_url: imageUrl || "" })}
                  alt={form.name}
                  editable
                  onUploadError={(message) =>
                    showError(t("common.errorOccurred", { message }))
                  }
                />
                <div className="min-w-0 flex-1 space-y-4">
                  {isCreatePage ? (
                    <>
                      <FormField label={t("forms.productName")} required>
                        <input
                          ref={nameFieldRef}
                          type="text"
                          required
                          value={form.name}
                          onChange={(e) => set({ name: e.target.value })}
                          className={formInputClass}
                        />
                      </FormField>
                      <div className={metaRowClass}>
                        <FormField label={t("forms.productCode")}>
                          <input
                            type="text"
                            value={form.code}
                            onChange={(e) => set({ code: e.target.value })}
                            placeholder={t("forms.autoGenerated")}
                            className={formInputClass}
                          />
                        </FormField>
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
                    </>
                  ) : (
                    <>
                      <div className={rowClass}>
                        <FormField label={t("forms.productName")} required>
                          <input
                            ref={nameFieldRef}
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
                    </>
                  )}
                </div>
              </div>
            </ProductFormSection>

            {!isServiceCategorySelected ? (
              <ProductFormSection
                title={t("forms.sectionMetricsPricing")}
                compact
                embedded={isDrawerLayout}
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className={toggleOptionClass(form.is_dimensional, isComposite)}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[color:var(--erp-color-primary)]"
                      checked={form.is_dimensional}
                      disabled={isComposite}
                      onChange={(event) => handleDimensionalToggle(event.target.checked)}
                    />
                    <span className="font-medium leading-snug">{t("forms.isDimensionalProduct")}</span>
                  </label>

                  <label className={toggleOptionClass(isComposite, form.is_dimensional)}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[color:var(--erp-color-primary)]"
                      checked={isComposite}
                      disabled={form.is_dimensional}
                      onChange={(e) => handleCompositeToggle(e.target.checked)}
                    />
                    <span className="font-medium leading-snug">{t("products.bom.isComposite")}</span>
                  </label>
                </div>

                {showDimensionFields ? (
                  <div
                    className={
                      isDrawerLayout
                        ? "grid grid-cols-1 gap-4 sm:grid-cols-3"
                        : "grid grid-cols-2 gap-4"
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
                    <FormField label={t("forms.standardBarLength")}>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.base_length}
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
                  </div>
                ) : null}

                {showPriceRows ? (
                  <ProductPriceRowsEditor
                    value={priceRows}
                    onChange={setPriceRows}
                    layout={isDrawerLayout ? "stack" : "grid"}
                  />
                ) : null}

                {showPriceRows ? (
                  <div className="space-y-3 border-t border-[color:var(--erp-border-default)] pt-4">
                    <div>
                      <p className="text-sm font-semibold">{t("forms.priceTiers")}</p>
                      <p className="text-xs text-slate-700 dark:text-app-muted">
                        {t("forms.priceTiersHint")}
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <FormField label={t("forms.priceWholesale")}>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={form.price_wholesale}
                          onChange={(e) => set({ price_wholesale: e.target.value })}
                          placeholder={t("forms.priceTierPlaceholder")}
                          className={formInputClass}
                        />
                      </FormField>
                      <FormField label={t("forms.priceDistributor")}>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={form.price_distributor}
                          onChange={(e) => set({ price_distributor: e.target.value })}
                          placeholder={t("forms.priceTierPlaceholder")}
                          className={formInputClass}
                        />
                      </FormField>
                    </div>
                  </div>
                ) : null}
              </ProductFormSection>
            ) : null}

            <ProductFormSection
              title={t("products.metadata.title")}
              compact
              embedded={isDrawerLayout}
            >
              <div className={rowClass}>
                <FormField label={t("products.metadata.brand")}>
                  <input
                    type="text"
                    value={form.brand}
                    onChange={(e) => set({ brand: e.target.value })}
                    className={formInputClass}
                  />
                </FormField>
                <FormField label={t("products.metadata.country")}>
                  <input
                    type="text"
                    value={form.country_of_origin}
                    onChange={(e) => set({ country_of_origin: e.target.value })}
                    className={formInputClass}
                  />
                </FormField>
                <FormField label={t("products.metadata.mfgDate")}>
                  <input
                    type="date"
                    value={form.mfg_date}
                    onChange={(e) => set({ mfg_date: e.target.value })}
                    className={formInputClass}
                  />
                </FormField>
                <FormField label={t("products.metadata.expDate")}>
                  <input
                    type="date"
                    value={form.exp_date}
                    onChange={(e) => set({ exp_date: e.target.value })}
                    className={formInputClass}
                  />
                </FormField>
              </div>
            </ProductFormSection>

            {isComposite && !isServiceCategorySelected ? (
              <ProductFormSection title={t("products.bom.isComposite")} embedded={isDrawerLayout}>
                <ProductBomBuilder
                  products={catalogProducts}
                  parentProductId={initialProduct?.id}
                  rows={bomRows}
                  onChange={setBomRows}
                />
                <p className="text-xs text-slate-700 dark:text-app-muted">{t("products.bom.stockHint")}</p>
              </ProductFormSection>
            ) : null}

            {!isServiceCategorySelected && !barcodeModuleEnabled ? (
              <ProductFormSection
                title={t("forms.sectionExtraSettings")}
                compact
                embedded={isDrawerLayout}
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField label={t("forms.minStockThreshold")}>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={form.min_stock}
                      onChange={(e) => set({ min_stock: e.target.value })}
                      placeholder="0"
                      className={formInputClass}
                    />
                  </FormField>
                  <FormField label={t("forms.extraInfo")}>
                    <textarea
                      rows={3}
                      value={form.extra_info}
                      onChange={(e) => set({ extra_info: e.target.value })}
                      className={formTextareaClass}
                    />
                  </FormField>
                </div>
              </ProductFormSection>
            ) : null}

            {barcodeModuleEnabled && !isServiceCategorySelected && isDrawerLayout ? (
              <ProductFormSection title={t("forms.sectionBarcodeRules")} embedded>
                <ProductBarcodePanel
                  value={form.barcode}
                  onChange={(barcode) => set({ barcode })}
                  productName={form.name}
                  productCode={form.code}
                  sellPrice={parseFieldNumber(priceRows.sell[0]?.price ?? "", 0) || null}
                  layout="stacked"
                />
                <div className="mt-4 grid grid-cols-1 gap-4 border-t border-[color:var(--erp-border-default)] pt-4 sm:grid-cols-2">
                  <FormField label={t("forms.minStockThreshold")}>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={form.min_stock}
                      onChange={(e) => set({ min_stock: e.target.value })}
                      placeholder="0"
                      className={formInputClass}
                    />
                  </FormField>
                  <FormField label={t("forms.extraInfo")} className="sm:col-span-2">
                    <textarea
                      rows={3}
                      value={form.extra_info}
                      onChange={(e) => set({ extra_info: e.target.value })}
                      className={formTextareaClass}
                    />
                  </FormField>
                </div>
              </ProductFormSection>
            ) : null}
          </div>

          {barcodeModuleEnabled && !isServiceCategorySelected && !isDrawerLayout ? (
            <div className={`flex w-full flex-col ${sectionStackClass} lg:col-span-4`}>
              <ProductFormSection title={t("forms.sectionBarcodeRules")}>
                <ProductBarcodePanel
                  value={form.barcode}
                  onChange={(barcode) => set({ barcode })}
                  productName={form.name}
                  productCode={form.code}
                  sellPrice={parseFieldNumber(priceRows.sell[0]?.price ?? "", 0) || null}
                />
                <div className="mt-4 space-y-3 border-t border-[color:var(--erp-border-default)] pt-4">
                  <FormField label={t("forms.minStockThreshold")}>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={form.min_stock}
                      onChange={(e) => set({ min_stock: e.target.value })}
                      placeholder="0"
                      className={formInputClass}
                    />
                  </FormField>
                  <FormField label={t("forms.extraInfo")}>
                    <textarea
                      rows={3}
                      value={form.extra_info}
                      onChange={(e) => set({ extra_info: e.target.value })}
                      className={formTextareaClass}
                    />
                  </FormField>
                </div>
              </ProductFormSection>
            </div>
          ) : null}
        </div>
        </fieldset>

      </form>
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </>
  );
}
