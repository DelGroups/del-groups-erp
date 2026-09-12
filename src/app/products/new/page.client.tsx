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
    <div className="grid w-full grid-cols-1 gap-6 lg:grid-cols-12">
      <div className="flex w-full flex-col gap-6 lg:col-span-8">
        <div className="w-full rounded-xl border border-app bg-app-card p-6 space-y-4">
          <Skeleton className="h-4 w-32" />
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
        <div className="w-full rounded-xl border border-app bg-app-card p-6">
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      </div>
      <div className="flex w-full flex-col gap-6 lg:col-span-4">
        <div className="w-full rounded-xl border border-app bg-app-card p-6">
          <Skeleton className="h-40 w-full" />
        </div>
        <div className="w-full rounded-xl border border-app bg-app-card p-6">
          <Skeleton className="h-24 w-full" />
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
        contentClassName="p-0"
        breadcrumbs={[
          { label: t("nav.items.products"), href: "/products" },
          { label: t("products.createLabel") },
        ]}
      >
        <div className="mx-auto w-full max-w-6xl p-6">
          {isLoading ? (
            <ProductFormSkeleton />
          ) : (
            <ProductForm
              layout="create-page"
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
