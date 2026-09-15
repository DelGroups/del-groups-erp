"use client";

import React, { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PageLayout from "@/components/layout/PageLayout";
import ProductForm from "@/components/products/ProductForm";
import { FormLayout } from "@/components/ui/form-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useProductsCatalog } from "@/hooks/useProductsCatalog";
import { buildProductClonePrefill } from "@/lib/products/cloneProduct";
import { useI18n } from "@/i18n/I18nProvider";
import type { Product } from "@/types/database.types";

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
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const { data: catalog, isLoading } = useProductsCatalog();
  const categories = catalog?.categories ?? [];
  const warehouses = catalog?.warehouses ?? [];
  const products = catalog?.products ?? [];
  const cloneId = searchParams.get("cloneId");
  const cloneSource = cloneId ? products.find((product) => product.id === cloneId) : null;
  const clonePrefill = useMemo(
    () => (cloneSource ? buildProductClonePrefill(cloneSource) : null),
    [cloneSource]
  );
  const initialProduct = clonePrefill as Product | null;

  return (
    <PageLayout>
      <FormLayout
        fullWidth
        title={cloneSource ? t("products.cloneTitle") : t("products.newTitle")}
        subtitle={cloneSource ? t("products.cloneSubtitle") : t("products.newSubtitle")}
        breadcrumbs={[
          { label: t("nav.items.products"), href: "/products" },
          { label: t("products.createLabel") },
        ]}
      >
        {isLoading ? (
          <ProductFormSkeleton />
        ) : (
          <ProductForm
            layout="create-page"
            categories={categories}
            warehouses={warehouses}
            allProducts={products}
            initialProduct={initialProduct}
            cloneSourceId={cloneId}
            isClone={Boolean(cloneSource)}
            onCancel={() => router.push("/products")}
            onSuccess={() => router.push("/products")}
          />
        )}
      </FormLayout>
    </PageLayout>
  );
}
