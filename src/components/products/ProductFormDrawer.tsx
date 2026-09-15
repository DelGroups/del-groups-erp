"use client";

import React, { useState } from "react";
import type { Category, Product, Warehouse } from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";
import { Drawer } from "@/components/ui/drawer";
import Button from "@/components/ui/button";
import ProductForm from "@/components/products/ProductForm";

export const PRODUCT_FORM_DRAWER_ID = "product-form-drawer";

interface ProductFormDrawerProps {
  open: boolean;
  product: Product | null;
  categories: Category[];
  warehouses: Warehouse[];
  allProducts: Product[];
  onClose: () => void;
  onSuccess: () => void;
}

export default function ProductFormDrawer({
  open,
  product,
  categories,
  warehouses,
  allProducts,
  onClose,
  onSuccess,
}: ProductFormDrawerProps) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);

  if (!product) return null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`${t("common.edit")}: ${product.name}`}
      className="sm:max-w-[min(44rem,96vw)]"
      headerActions={
        <>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            form={PRODUCT_FORM_DRAWER_ID}
            size="sm"
            loading={saving}
            disabled={saving}
          >
            {saving ? t("common.saving") : t("common.edit")}
          </Button>
        </>
      }
    >
      <ProductForm
        formId={PRODUCT_FORM_DRAWER_ID}
        categories={categories}
        warehouses={warehouses}
        allProducts={allProducts}
        initialProduct={product}
        onCancel={onClose}
        onSuccess={onSuccess}
        embedded
        onSavingChange={setSaving}
      />
    </Drawer>
  );
}
