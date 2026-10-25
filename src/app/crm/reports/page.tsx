import { notFound } from "next/navigation";
import { isNewUiEnabled } from "@/lib/features/newUi";
import { isNewCrmEnabled } from "@/lib/features/newCrm";
import NewCrmPage from "../newCrmPage.client";

export const dynamic = "force-dynamic";

/** CRM reports: funnel, forecast, win rate, lost reasons, targets (prompt 21). 404 unless NEW_UI and NEW_CRM are on. */
export default function CrmReportsPage() {
  if (!isNewUiEnabled() || !isNewCrmEnabled()) notFound();
  return <NewCrmPage screen="reports" />;
}
