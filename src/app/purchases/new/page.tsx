import { Suspense } from "react";
import NewPurchasePage from "./page.client";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <NewPurchasePage />
    </Suspense>
  );
}
