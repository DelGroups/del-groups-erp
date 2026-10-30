"use client";

import dynamic from "next/dynamic";
import NewUiOnlyNote from "@/app/imports/NewUiOnlyNote";
import { useNewUi } from "@/components/shell/NewUiProvider";

const ImportSettingsScreen = dynamic(() => import("@/modules/imports/pages").then((m) => m.ImportSettingsScreen), { ssr: false });

export default function ImportSettingsPageClient() {
  const { active } = useNewUi();
  return active ? <ImportSettingsScreen /> : <NewUiOnlyNote />;
}
