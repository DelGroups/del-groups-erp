"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import PurchaseForm from "@/components/purchases/PurchaseForm";
import { FormLayout } from "@/components/ui/form-layout";
import { fetchPurchaseById, fetchPurchaseFormData } from "@/lib/purchases/fetchPurchases";
import type { Product, PurchaseRecord, Supplier, Warehouse } from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";

export default function NewPurchasePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftId = searchParams.get("draft");
  const { t } = useI18n();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [initialPurchase, setInitialPurchase] = useState<PurchaseRecord | null>(null);
  const [loading, setLoading] = useState(true);

  const goToList = useCallback(() => router.push("/purchases"), [router]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      const formData = await fetchPurchaseFormData();
      if (!active) return;
      setSuppliers(formData.suppliers);
      setProducts(formData.products);
      setWarehouses(formData.warehouses);

      if (draftId) {
        const draft = await fetchPurchaseById(draftId);
        if (!active) return;
        setInitialPurchase(draft);
      } else {
        setInitialPurchase(null);
      }
      setLoading(false);
    };
    void load();
    return () => {
      active = false;
    };
  }, [draftId]);

  const title = initialPurchase ? t("forms.purchaseEditTitle") : t("forms.purchaseNewTitle");

  return (
    <PageLayout>
      <FormLayout
        title={title}
        subtitle={t("forms.purchaseFormSubtitle")}
        breadcrumbs={[
          { label: t("nav.items.purchases"), href: "/purchases" },
          { label: title },
        ]}
      >
        {loading ? (
          <div className="p-12 text-center text-sm text-app-muted">{t("common.loading")}</div>
        ) : (
          <PurchaseForm
            key={initialPurchase?.id || "new"}
            layoutMode="page"
            suppliers={suppliers}
            products={products}
            warehouses={warehouses}
            mode={initialPurchase ? "edit" : "create"}
            initialPurchase={initialPurchase}
            draftId={draftId}
            onCancel={goToList}
            onSuccess={goToList}
            onDraftSaved={(purchaseId) => {
              router.replace(`/purchases/new?draft=${purchaseId}`);
            }}
          />
        )}
      </FormLayout>
    </PageLayout>
  );
}
