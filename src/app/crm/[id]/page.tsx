import { notFound } from "next/navigation";
import { isNewUiEnabled } from "@/lib/features/newUi";
import { isNewCrmEnabled } from "@/lib/features/newCrm";
import { isValidUuid } from "@/lib/auth/validate";
import DealPageClient from "./page.client";

export const dynamic = "force-dynamic";

/** One CRM deal in the view engine's form (prompt 17; new CRM with NEW_CRM, prompt 21). 404 while NEW_UI is off. */
export default async function CrmDealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isNewUiEnabled() || !isValidUuid(id)) notFound();
  return <DealPageClient id={id} newCrm={isNewCrmEnabled()} />;
}
