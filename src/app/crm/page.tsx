import { CrmPipelinePage } from "@/modules/crm/pages";
import { isNewUiEnabled } from "@/lib/features/newUi";
import { isNewCrmEnabled } from "@/lib/features/newCrm";
import CrmNewUiSwitch from "./page.client";

export const dynamic = "force-dynamic";

export default function CrmPage() {
  // NEW_UI off (production): exactly the classic pipeline, nothing else is loaded.
  if (!isNewUiEnabled()) return <CrmPipelinePage />;
  return <CrmNewUiSwitch newCrm={isNewCrmEnabled()} />;
}
