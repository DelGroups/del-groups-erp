"use client";

import dynamic from "next/dynamic";
import { ContractsPage } from "@/modules/contracts/pages";
import { useNewUi } from "@/components/shell/NewUiProvider";

// The view engine is loaded only by users of the new shell.
const ContractsScreen = dynamic(() => import("@/modules/contracts/pages").then((m) => m.ContractsScreen), { ssr: false });

/** With NEW_UI on: the screen on the view engine for users of the new shell, the classic page otherwise. */
export default function NewUiSwitch() {
  const { active } = useNewUi();
  return active ? <ContractsScreen /> : <ContractsPage />;
}
