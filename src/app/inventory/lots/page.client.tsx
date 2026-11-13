"use client";

import dynamic from "next/dynamic";
import { LotsNewUiOnlyNote as NewUiOnlyNote } from "@/modules/inventory/pages";
import { useNewUi } from "@/components/shell/NewUiProvider";

const LotsScreen = dynamic(() => import("@/modules/inventory/pages").then((m) => m.LotsScreen), { ssr: false });

/** The lot list in the new shell; users of the classic layout get a short note. */
export default function LotsPageClient({ productId }: { productId: string | null }) {
  const { active } = useNewUi();
  return active ? <LotsScreen productId={productId} /> : <NewUiOnlyNote />;
}
