"use client";

import dynamic from "next/dynamic";
import { SaleDetailPage } from "@/modules/sales/pages";
import { useNewUi } from "@/components/shell/NewUiProvider";

const SaleFormScreen = dynamic(() => import("@/modules/sales/pages").then((m) => m.SaleFormScreen), { ssr: false });

/** With NEW_UI on: the invoice in the view engine's form in the new shell, the classic page otherwise. */
export default function SaleNewUiSwitch({ id }: { id: string }) {
  const { active } = useNewUi();
  return active ? <SaleFormScreen id={id} /> : <SaleDetailPage saleId={id} />;
}
