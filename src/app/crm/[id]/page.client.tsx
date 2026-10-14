"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useNewUi } from "@/components/shell/NewUiProvider";

const CrmDealFormScreen = dynamic(() => import("@/modules/crm/pages").then((m) => m.CrmDealFormScreen), { ssr: false });

/** The deal form belongs to the new shell; users of the classic shell go to the pipeline. */
export default function DealPageClient({ id }: { id: string }) {
  const { active } = useNewUi();
  const router = useRouter();
  useEffect(() => {
    if (!active) router.replace("/crm");
  }, [active, router]);
  return active ? <CrmDealFormScreen id={id} /> : null;
}
