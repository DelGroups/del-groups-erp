"use client";

import dynamic from "next/dynamic";
import NewUiOnlyNote from "../NewUiOnlyNote";
import { useNewUi } from "@/components/shell/NewUiProvider";

const ImportReportsScreen = dynamic(() => import("@/modules/imports/pages").then((m) => m.ImportReportsScreen), { ssr: false });

export default function ImportReportsPageClient() {
  const { active } = useNewUi();
  return active ? <ImportReportsScreen /> : <NewUiOnlyNote />;
}
