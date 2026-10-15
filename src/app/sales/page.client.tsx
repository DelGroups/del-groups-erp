"use client";

import dynamic from "next/dynamic";
import { SalesPage } from "@/modules/sales/pages";
import { useNewUi } from "@/components/shell/NewUiProvider";

// The view engine is loaded only by users of the new shell.
const SalesScreen = dynamic(() => import("@/modules/sales/pages").then((m) => m.SalesScreen), { ssr: false });

/** With NEW_UI on: sales on the view engine in the new shell, the classic list otherwise. */
export default function SalesNewUiSwitch() {
  const { active } = useNewUi();
  return active ? <SalesScreen /> : <SalesPage />;
}
