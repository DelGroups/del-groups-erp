"use client";

import dynamic from "next/dynamic";
import { CrmPipelinePage } from "@/modules/crm/pages";
import { useNewUi } from "@/components/shell/NewUiProvider";

// The view engine is loaded only by users of the new shell.
const CrmDealsScreen = dynamic(() => import("@/modules/crm/pages").then((m) => m.CrmDealsScreen), { ssr: false });

/** With NEW_UI on: the deals view engine in the new shell, the classic pipeline otherwise. */
export default function CrmNewUiSwitch() {
  const { active } = useNewUi();
  return active ? <CrmDealsScreen /> : <CrmPipelinePage />;
}
