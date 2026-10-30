import { notFound } from "next/navigation";
import { isNewUiEnabled } from "@/lib/features/newUi";
import { isNewImportsEnabled } from "@/lib/features/newImports";
import ImportSettingsPageClient from "./page.client";

export const dynamic = "force-dynamic";

/** Settings › Imports (IMP-1): 404 while NEW_UI or NEW_IMPORTS is off. */
export default function ImportSettingsPage() {
  if (!isNewUiEnabled() || !isNewImportsEnabled()) notFound();
  return <ImportSettingsPageClient />;
}
