import { notFound } from "next/navigation";
import { isNewUiEnabled } from "@/lib/features/newUi";
import { isNewImportsEnabled } from "@/lib/features/newImports";
import ImportsNewUiOnly from "./page.client";

export const dynamic = "force-dynamic";

/** Import shipments (IMP-1): new UI only and behind NEW_IMPORTS; otherwise a 404. */
export default function ImportsPage() {
  if (!isNewUiEnabled() || !isNewImportsEnabled()) notFound();
  return <ImportsNewUiOnly />;
}
