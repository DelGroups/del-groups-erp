"use client";

import dynamic from "next/dynamic";
import { PurchasesPage } from "@/modules/purchases/pages";
import { useNewUi } from "@/components/shell/NewUiProvider";

// The view engine is loaded only by users of the new shell.
const PurchasesScreen = dynamic(() => import("@/modules/purchases/pages").then((m) => m.PurchasesScreen), { ssr: false });

/** With NEW_UI on: the screen on the view engine for users of the new shell, the classic page otherwise. */
export default function NewUiSwitch() {
  const { active } = useNewUi();
  return active ? <PurchasesScreen /> : <PurchasesPage />;
}
