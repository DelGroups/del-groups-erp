"use client";

import dynamic from "next/dynamic";
import NewUiOnlyNote from "./NewUiOnlyNote";
import { useNewUi } from "@/components/shell/NewUiProvider";

const ImportsScreen = dynamic(() => import("@/modules/imports/pages").then((m) => m.ImportsScreen), { ssr: false });

/** The shipments list in the new shell; users of the classic layout get a short note. */
export default function ImportsNewUiOnly() {
  const { active } = useNewUi();
  return active ? <ImportsScreen /> : <NewUiOnlyNote />;
}
