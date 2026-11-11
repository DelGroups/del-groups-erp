import { Suspense } from "react";
import { notFound } from "next/navigation";
import { DebtorCreditorPage } from "@/modules/accounting/pages";
import { partnerLedgersActiveForRequest } from "@/lib/features/partnerLedgersServer";

export const dynamic = "force-dynamic";

/** "Debitor və kreditor borcları" (LED-4): only with PARTNER_LEDGERS on, for its audience with can_view_financial_reports. */
export default async function Page() {
  if (!(await partnerLedgersActiveForRequest())) notFound();
  return (
    <Suspense fallback={null}>
      <DebtorCreditorPage />
    </Suspense>
  );
}
