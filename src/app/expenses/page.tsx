import { ExpensesPage } from "@/modules/expenses/pages";
import { isNewUiEnabled } from "@/lib/features/newUi";
import NewUiSwitch from "./page.client";

export const dynamic = "force-dynamic";

export default function Page() {
  // NEW_UI off (production): exactly the classic page, nothing else is loaded.
  if (!isNewUiEnabled()) return <ExpensesPage />;
  return <NewUiSwitch />;
}
