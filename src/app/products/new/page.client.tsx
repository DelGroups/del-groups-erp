"use client";

import React from "react";
import { useRouter } from "next/navigation";
import PageLayout from "@/components/layout/PageLayout";
import ProductForm from "@/components/products/ProductForm";
import { FormLayout } from "@/components/ui/form-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { useProductsCatalog } from "@/hooks/useProductsCatalog";
import { useI18n } from "@/i18n/I18nProvider";

function ProductFormSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6">
      <div className="space-y-4 lg:col-span-8">
        <div className="rounded-xl border border-app bg-app-card p-5 space-y-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
        <div className="rounded-xl border border-app bg-app-card p-5">
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      </div>
      <div className="space-y-4 lg:col-span-4">
        <div className="rounded-xl border border-app bg-app-card p-5">
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    </div>
  );
}

export default function NewProductPage() {
  const router = useRouter();
  const { t } = useI18n();
  const { data: catalog, isLoading } = useProductsCatalog();
  const categories = catalog?.categories ?? [];
  const warehouses = catalog?.warehouses ?? [];
  const products = catalog?.products ?? [];

  return (
    <PageLayout>
      <FormLayout
        title={t("products.newTitle")}
        subtitle={t("products.newSubtitle")}
        withStickyFooter
        breadcrumbs={[
          { label: t("nav.items.products"), href: "/products" },
          { label: t("products.createLabel") },
        ]}
        actions={
          <button
            type="button"
            onClick={() => router.push("/products")}
            className="rounded-lg border border-app bg-app-card px-4 py-2 text-xs font-semibold text-app transition-colors hover:bg-app-card-hover"
          >
            {t("common.cancel")}
          </button>
        }
      >
        {isLoading ? (
          <ProductFormSkeleton />
        ) : (
          <ProductForm
            categories={categories}
            warehouses={warehouses}
            allProducts={products}
            onCancel={() => router.push("/products")}
            onSuccess={() => router.push("/products")}
          />
        )}
      </FormLayout>
    </PageLayout>
  );
}
