"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageLayout from "@/components/layout/PageLayout";
import ProductForm from "@/components/products/ProductForm";
import { fetchProductsCatalog } from "@/lib/products/api";
import type { Category, Warehouse } from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";
import { ArrowLeft, PackagePlus } from "lucide-react";

export default function NewProductPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [categories, setCategories] = useState<Category[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchProductsCatalog().then((data) => {
      setCategories(data.categories);
      setWarehouses(data.warehouses);
      setLoading(false);
    });
  }, []);

  return (
    <PageLayout>
        <header className="border-b border-app app-glass px-6 py-4">
          <Link
            href="/products"
            className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-app-accent hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("products.backToList")}
          </Link>
          <h2 className="flex items-center gap-2 text-xl font-bold text-app">
            <PackagePlus className="h-6 w-6 text-app-accent" />
            {t("products.newTitle")}
          </h2>
          <p className="text-sm text-app-muted">{t("products.newSubtitle")}</p>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="app-card rounded-xl p-12 text-center text-sm text-app-muted">
              {t("products.formLoading")}
            </div>
          ) : (
            <div className="mx-auto max-w-4xl">
              <ProductForm
                categories={categories}
                warehouses={warehouses}
                onCancel={() => router.push("/products")}
                onSuccess={() => router.push("/products")}
              />
            </div>
          )}
        </main>
      </PageLayout>
  );
}
