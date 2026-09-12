"use client";

import React from "react";
import type { Category, Product, Warehouse } from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";
import { Drawer } from "@/components/ui/drawer";
import ProductForm from "@/components/products/ProductForm";

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

  if (!product) return null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`${t("common.edit")}: ${product.name}`}
      className="sm:max-w-[52rem]"
    >
      <ProductForm
        categories={categories}
        warehouses={warehouses}
        allProducts={allProducts}
        initialProduct={product}
        onCancel={onClose}
        onSuccess={onSuccess}
        embedded
      />
    </Drawer>
  );
}
