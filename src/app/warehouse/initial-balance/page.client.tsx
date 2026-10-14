"use client";

import dynamic from "next/dynamic";
import { InitialBalanceListPage } from "@/modules/inventory/pages";
import { useNewUi } from "@/components/shell/NewUiProvider";

// The view engine is loaded only by users of the new shell.
const InitialBalanceScreen = dynamic(() => import("@/modules/inventory/pages").then((m) => m.InitialBalanceScreen), { ssr: false });

/** With NEW_UI on: the screen on the view engine for users of the new shell, the classic page otherwise. */
export default function NewUiSwitch() {
  const { active } = useNewUi();
  return active ? <InitialBalanceScreen /> : <InitialBalanceListPage />;
}
