import { Suspense } from "react";
import { PurchaseNewPage } from "@/modules/purchases/pages";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PurchaseNewPage />
    </Suspense>
  );
}
