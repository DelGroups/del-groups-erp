"use client";

import dynamic from "next/dynamic";
import { CrmPipelinePage } from "@/modules/crm/pages";
import { useNewUi } from "@/components/shell/NewUiProvider";

// The view engine is loaded only by users of the new shell.
const CrmDealsScreen = dynamic(() => import("@/modules/crm/pages").then((m) => m.CrmDealsScreen), { ssr: false });
const CrmPipelineScreen = dynamic(() => import("@/modules/crm/pages").then((m) => m.CrmPipelineScreen), { ssr: false });

/**
 * With NEW_UI on: in the new shell the new CRM pipeline (NEW_CRM on) or the deals view engine;
 * the classic pipeline otherwise.
 */
export default function CrmNewUiSwitch({ newCrm }: { newCrm: boolean }) {
  const { active } = useNewUi();
  if (!active) return <CrmPipelinePage />;
  return newCrm ? <CrmPipelineScreen /> : <CrmDealsScreen />;
}
