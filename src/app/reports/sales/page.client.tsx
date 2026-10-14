"use client";

import dynamic from "next/dynamic";
import { SalesReportPage } from "@/modules/sales/pages";
import { useNewUi } from "@/components/shell/NewUiProvider";

const SalesReportScreen = dynamic(() => import("@/modules/sales/pages").then((m) => m.SalesReportScreen), { ssr: false });

/** With NEW_UI on: the sales report on the view engine in the new shell, the classic report otherwise. */
export default function SalesReportNewUiSwitch() {
  const { active } = useNewUi();
  return active ? <SalesReportScreen /> : <SalesReportPage />;
}
