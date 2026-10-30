import { notFound } from "next/navigation";
import { isNewUiEnabled } from "@/lib/features/newUi";
import { isNewImportsEnabled } from "@/lib/features/newImports";
import ImportReportsPageClient from "./page.client";

export const dynamic = "force-dynamic";

/** Imports reports (IMP-3): 404 while NEW_UI or NEW_IMPORTS is off. */
export default function ImportReportsPage() {
  if (!isNewUiEnabled() || !isNewImportsEnabled()) notFound();
  return <ImportReportsPageClient />;
}
