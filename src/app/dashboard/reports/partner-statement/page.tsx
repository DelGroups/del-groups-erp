import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PartnerStatementPage } from "@/modules/accounting/pages";
import { partnerLedgersActiveForRequest } from "@/lib/features/partnerLedgersServer";

export const dynamic = "force-dynamic";

/** "Hesab çıxarışı" (LED-3): only with PARTNER_LEDGERS on, for its audience with can_view_financial_reports. */
export default async function Page() {
  if (!(await partnerLedgersActiveForRequest())) notFound();
  return (
    <Suspense fallback={null}>
      <PartnerStatementPage />
    </Suspense>
  );
}
