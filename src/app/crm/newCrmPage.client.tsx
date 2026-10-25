"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useNewUi } from "@/components/shell/NewUiProvider";

const SCREENS = {
  leads: dynamic(() => import("@/modules/crm/pages").then((m) => m.CrmLeadsScreen), { ssr: false }),
  reports: dynamic(() => import("@/modules/crm/pages").then((m) => m.CrmReportsScreen), { ssr: false }),
  config: dynamic(() => import("@/modules/crm/pages").then((m) => m.CrmConfigScreen), { ssr: false }),
};

/** A page of the new CRM (NEW_CRM): new shell only; users of the classic shell go to the pipeline. */
export default function NewCrmPage({ screen }: { screen: keyof typeof SCREENS }) {
  const { active } = useNewUi();
  const router = useRouter();
  useEffect(() => {
    if (!active) router.replace("/crm");
  }, [active, router]);
  const Screen = SCREENS[screen];
  return active ? <Screen /> : null;
}
