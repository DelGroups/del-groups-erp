"use client";

import { useRouter } from "next/navigation";
import PageLayout from "@/components/layout/PageLayout";
import UniversalInvoiceForm from "@/components/InvoiceForm";

export default function NewSalePage() {
  const router = useRouter();
  const goToList = () => router.push("/sales");

  return (
    <PageLayout>
      <UniversalInvoiceForm
        isOpen
        defaultType="sale"
        onClose={goToList}
        onSuccess={goToList}
      />
    </PageLayout>
  );
}
