import { SalesPage } from "@/modules/sales/pages";
import { isNewUiEnabled } from "@/lib/features/newUi";
import SalesNewUiSwitch from "./page.client";

export const dynamic = "force-dynamic";

export default function Page() {
  // NEW_UI off (production): exactly the classic sales list, nothing else is loaded.
  if (!isNewUiEnabled()) return <SalesPage />;
  return <SalesNewUiSwitch />;
}
