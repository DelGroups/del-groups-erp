import { PaymentsPage } from "@/modules/accounting/pages";
import { isNewUiEnabled } from "@/lib/features/newUi";
import NewUiSwitch from "./page.client";

export const dynamic = "force-dynamic";

export default function Page() {
  // NEW_UI off (production): exactly the classic page, nothing else is loaded.
  if (!isNewUiEnabled()) return <PaymentsPage />;
  return <NewUiSwitch />;
}
