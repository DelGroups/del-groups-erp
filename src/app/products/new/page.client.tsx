"use client";

import React from "react";
import { useRouter } from "next/navigation";
import PageLayout from "@/components/layout/PageLayout";
import ProductForm from "@/components/products/ProductForm";
import { FormLayout } from "@/components/ui/form-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useProductsCatalog } from "@/hooks/useProductsCatalog";
import { useI18n } from "@/i18n/I18nProvider";

function ProductFormSkeletonSection({ title }: { title?: string }) {
  return (
    <Card padding={false}>
      {title ? (
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
      ) : (
        <CardHeader>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
      )}
      <CardContent className="space-y-4 p-6 pt-4">
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </CardContent>
    </Card>
  );
}

function ProductFormSkeleton() {
  return (
    <div className="grid w-full grid-cols-1 items-start gap-6 lg:grid-cols-12">
      <div className="flex w-full flex-col gap-6 lg:col-span-8">
        <ProductFormSkeletonSection />
        <Card padding={false}>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent className="p-6 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="flex w-full flex-col gap-6 lg:col-span-4">
        <Card padding={false}>
          <CardHeader>
            <Skeleton className="h-5 w-28" />
          </CardHeader>
          <CardContent className="p-6 pt-4">
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
        <Card padding={false}>
          <CardHeader>
            <Skeleton className="h-5 w-36" />
          </CardHeader>
          <CardContent className="p-6 pt-4">
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
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
        fullWidth
        withStickyFooter
        title={t("products.newTitle")}
        subtitle={t("products.newSubtitle")}
        contentClassName="bg-[color:var(--gt-bg-main)] p-0"
        breadcrumbs={[
          { label: t("nav.items.products"), href: "/products" },
          { label: t("products.createLabel") },
        ]}
      >
        <div className="-mx-[calc(var(--erp-content-padding-x)-1.5rem)] w-[calc(100%+2*(var(--erp-content-padding-x)-1.5rem))] max-w-none space-y-6 px-6">
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
