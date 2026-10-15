import { SalesReportPage } from "@/modules/sales/pages";
import { isNewUiEnabled } from "@/lib/features/newUi";
import SalesReportNewUiSwitch from "./page.client";

export const dynamic = "force-dynamic";

export default function Page() {
  // NEW_UI off (production): exactly the classic sales report.
  if (!isNewUiEnabled()) return <SalesReportPage />;
  return <SalesReportNewUiSwitch />;
}
