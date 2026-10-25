"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useNewUi } from "@/components/shell/NewUiProvider";

const CrmDealFormScreen = dynamic(() => import("@/modules/crm/pages").then((m) => m.CrmDealFormScreen), { ssr: false });
const CrmPipelineDealScreen = dynamic(() => import("@/modules/crm/pages").then((m) => m.CrmPipelineDealScreen), { ssr: false });

/** The deal form belongs to the new shell; users of the classic shell go to the pipeline. */
export default function DealPageClient({ id, newCrm }: { id: string; newCrm: boolean }) {
  const { active } = useNewUi();
  const router = useRouter();
  useEffect(() => {
    if (!active) router.replace("/crm");
  }, [active, router]);
  if (!active) return null;
  return newCrm ? <CrmPipelineDealScreen id={id} /> : <CrmDealFormScreen id={id} />;
}
