"use client";

import { useRouter } from "next/navigation";
import PageLayout from "@/components/layout/PageLayout";
import UniversalInvoiceForm from "@/components/InvoiceForm";

export default function PolywoodSalePageClient() {
  const router = useRouter();
  const goToSales = () => router.push("/sales");

  return (
    <PageLayout>
      <UniversalInvoiceForm
        isOpen
        defaultType="sale"
        invoiceMode="polywood"
        onClose={goToSales}
        onSuccess={goToSales}
      />
    </PageLayout>
  );
}
