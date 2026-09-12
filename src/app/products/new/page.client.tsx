"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PageLayout from "@/components/layout/PageLayout";
import ProductForm from "@/components/products/ProductForm";
import { FormLayout } from "@/components/ui/form-layout";
import { fetchProductsCatalog } from "@/lib/products/api";
import type { Category, Product, Warehouse } from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";

export default function NewProductPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [categories, setCategories] = useState<Category[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchProductsCatalog().then((data) => {
      setCategories(data.categories);
      setWarehouses(data.warehouses);
      setProducts(data.products);
      setLoading(false);
    });
  }, []);

  return (
    <PageLayout>
      <FormLayout
        fullWidth
        title={t("products.newTitle")}
        subtitle={t("products.newSubtitle")}
        breadcrumbs={[
          { label: t("nav.items.products"), href: "/products" },
          { label: t("products.createLabel") },
        ]}
        actions={
          <button
            type="button"
            onClick={() => router.push("/products")}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-app dark:bg-app-card dark:text-app"
          >
            {t("common.cancel")}
          </button>
        }
      >
        <div className="w-full">
          {loading ? (
            <div className="w-full rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500 shadow-sm dark:border-app dark:bg-app-card dark:text-app-muted">
              {t("products.formLoading")}
            </div>
          ) : (
            <ProductForm
              categories={categories}
              warehouses={warehouses}
              allProducts={products}
              onCancel={() => router.push("/products")}
              onSuccess={() => router.push("/products")}
            />
          )}
        </div>
      </FormLayout>
    </PageLayout>
  );
}
