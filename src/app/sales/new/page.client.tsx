"use client";

import { useRouter, useSearchParams } from "next/navigation";
import PageLayout from "@/components/layout/PageLayout";
import UniversalInvoiceForm from "@/components/InvoiceForm";
import { FormLayout } from "@/components/ui/form-layout";
import { useI18n } from "@/i18n/I18nProvider";

export default function NewSalePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftId = searchParams.get("draft");
  const { t } = useI18n();
  const goToList = () => router.push("/sales");

  return (
    <PageLayout>
      <FormLayout
        title={t("invoice.newSaleTitle")}
        subtitle={t("invoice.newSaleSubtitle")}
        breadcrumbs={[
          { label: t("nav.items.sales"), href: "/sales" },
          { label: t("invoice.newSaleTitle") },
        ]}
      >
        <UniversalInvoiceForm
          isOpen
          layoutMode="page"
          draftId={draftId}
          defaultType="sale"
          onClose={goToList}
          onSuccess={goToList}
          onDraftSaved={(saleId) => {
            router.replace(`/sales/new?draft=${saleId}`);
          }}
        />
      </FormLayout>
    </PageLayout>
  );
}
