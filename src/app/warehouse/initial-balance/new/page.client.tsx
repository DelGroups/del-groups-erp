"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import PageHeader from "@/components/ui/page-header";
import InitialBalanceForm from "@/components/initialBalance/InitialBalanceForm";
import { fetchInitialBalanceByIdAction } from "@/lib/initialBalance/actions";
import { fetchProductsCatalog } from "@/lib/products/api";
import type { InitialBalanceDocument } from "@/lib/initialBalance/types";
import type { Product, Warehouse } from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";

export default function InitialBalanceNewPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftId = searchParams.get("draft");
  const { t } = useI18n();

  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [initialDocument, setInitialDocument] = useState<InitialBalanceDocument | null>(null);
  const [loading, setLoading] = useState(true);

  const goToList = useCallback(() => router.push("/warehouse/initial-balance"), [router]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      const catalog = await fetchProductsCatalog();
      if (!active) return;
      setProducts(catalog.products);
      setWarehouses(catalog.warehouses);

      if (draftId) {
        const result = await fetchInitialBalanceByIdAction(draftId);
        if (!active) return;
        setInitialDocument(result.success ? result.data || null : null);
      } else {
        setInitialDocument(null);
      }
      setLoading(false);
    };
    void load();
    return () => {
      active = false;
    };
  }, [draftId]);

  if (loading) {
    return (
      <PageLayout>
        <div className="p-12 text-center text-sm text-app-muted">{t("common.loading")}</div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <PageHeader
        title={t("initialBalance.formTitle")}
        description={t("initialBalance.formDescription")}
      />
      <InitialBalanceForm
        products={products}
        warehouses={warehouses}
        initialDocument={initialDocument}
        onSuccess={() => {
          void goToList();
        }}
      />
    </PageLayout>
  );
}
