"use client";

import dynamic from "next/dynamic";
import { LotsNewUiOnlyNote as NewUiOnlyNote } from "@/modules/inventory/pages";
import { useNewUi } from "@/components/shell/NewUiProvider";

const LotCardScreen = dynamic(() => import("@/modules/inventory/pages").then((m) => m.LotCardScreen), { ssr: false });

export default function LotCardPageClient({ id }: { id: string }) {
  const { active } = useNewUi();
  return active ? <LotCardScreen id={id} /> : <NewUiOnlyNote />;
}
