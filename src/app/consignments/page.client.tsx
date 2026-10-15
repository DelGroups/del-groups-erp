"use client";

import dynamic from "next/dynamic";
import { ConsignmentsPage } from "@/modules/consignment/pages";
import { useNewUi } from "@/components/shell/NewUiProvider";

// The view engine is loaded only by users of the new shell.
const ConsignmentsScreen = dynamic(() => import("@/modules/consignment/pages").then((m) => m.ConsignmentsScreen), { ssr: false });

/** With NEW_UI on: the screen on the view engine for users of the new shell, the classic page otherwise. */
export default function NewUiSwitch() {
  const { active } = useNewUi();
  return active ? <ConsignmentsScreen /> : <ConsignmentsPage />;
}
