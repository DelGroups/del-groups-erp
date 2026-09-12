import { Suspense } from "react";
import InitialBalanceNewPageClient from "./page.client";

export const dynamic = "force-dynamic";

export default function InitialBalanceNewPage() {
  return (
    <Suspense fallback={null}>
      <InitialBalanceNewPageClient />
    </Suspense>
  );
}
