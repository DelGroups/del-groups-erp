import EmployeesPageClient from "./page.client";
import EmployeesNewUiSwitch from "./new-ui-switch";
import { isNewUiEnabled } from "@/lib/features/newUi";

export const dynamic = "force-dynamic";

export default function Page() {
  // NEW_UI off (production): exactly the classic page, nothing else is loaded.
  if (!isNewUiEnabled()) return <EmployeesPageClient />;
  return <EmployeesNewUiSwitch />;
}
