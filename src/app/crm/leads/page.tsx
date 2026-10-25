import { notFound } from "next/navigation";
import { isNewUiEnabled } from "@/lib/features/newUi";
import { isNewCrmEnabled } from "@/lib/features/newCrm";
import NewCrmPage from "../newCrmPage.client";

export const dynamic = "force-dynamic";

/** CRM leads (prompt 21). 404 unless NEW_UI and NEW_CRM are on. */
export default function CrmLeadsPage() {
  if (!isNewUiEnabled() || !isNewCrmEnabled()) notFound();
  return <NewCrmPage screen="leads" />;
}
