import { notFound } from "next/navigation";
import { isNewUiEnabled } from "@/lib/features/newUi";
import { isNewCrmEnabled } from "@/lib/features/newCrm";
import NewCrmPage from "../newCrmPage.client";

export const dynamic = "force-dynamic";

/** CRM settings: stages, teams, lost reasons, targets (prompt 21; route permission can_manage_settings). 404 unless NEW_UI and NEW_CRM are on. */
export default function CrmConfigPage() {
  if (!isNewUiEnabled() || !isNewCrmEnabled()) notFound();
  return <NewCrmPage screen="config" />;
}
