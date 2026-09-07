"use client";

import { useRouter } from "next/navigation";
import PageLayout from "@/components/layout/PageLayout";
import MixedDimensionalInvoiceForm from "@/components/polywood/MixedDimensionalInvoiceForm";

export default function PolywoodSalePageClient() {
  const router = useRouter();
  const goToSales = () => router.push("/sales");

  return (
    <PageLayout>
      <MixedDimensionalInvoiceForm onClose={goToSales} onSuccess={goToSales} />
    </PageLayout>
  );
}
