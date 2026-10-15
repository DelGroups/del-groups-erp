"use client";

import dynamic from "next/dynamic";
import { PaymentsPage } from "@/modules/accounting/pages";
import { useNewUi } from "@/components/shell/NewUiProvider";

// The view engine is loaded only by users of the new shell.
const PaymentsScreen = dynamic(() => import("@/modules/accounting/pages").then((m) => m.PaymentsScreen), { ssr: false });

/** With NEW_UI on: the screen on the view engine for users of the new shell, the classic page otherwise. */
export default function NewUiSwitch() {
  const { active } = useNewUi();
  return active ? <PaymentsScreen /> : <PaymentsPage />;
}
