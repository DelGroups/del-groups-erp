import { Suspense } from "react";
import { InitialBalanceNewPage } from "@/modules/inventory/pages";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <InitialBalanceNewPage />
    </Suspense>
  );
}
