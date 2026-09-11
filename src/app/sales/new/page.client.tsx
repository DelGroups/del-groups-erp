"use client";

import { useRouter, useSearchParams } from "next/navigation";
import PageLayout from "@/components/layout/PageLayout";
import UniversalInvoiceForm from "@/components/InvoiceForm";

export default function NewSalePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftId = searchParams.get("draft");
  const goToList = () => router.push("/sales");

  return (
    <PageLayout>
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
    </PageLayout>
  );
}
