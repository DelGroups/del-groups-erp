"use client";

import dynamic from "next/dynamic";
import NewUiOnlyNote from "../NewUiOnlyNote";
import { useNewUi } from "@/components/shell/NewUiProvider";

const ImportFormScreen = dynamic(() => import("@/modules/imports/pages").then((m) => m.ImportFormScreen), { ssr: false });

export default function ImportShipmentPageClient({ id }: { id: string }) {
  const { active } = useNewUi();
  return active ? <ImportFormScreen id={id} /> : <NewUiOnlyNote />;
}
