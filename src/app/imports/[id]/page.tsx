import { notFound } from "next/navigation";
import { isValidUuid } from "@/lib/auth/validate";
import { isNewUiEnabled } from "@/lib/features/newUi";
import { isNewImportsEnabled } from "@/lib/features/newImports";
import ImportShipmentPageClient from "./page.client";

export const dynamic = "force-dynamic";

/** One import shipment, or "new" for a new draft (IMP-1). 404 while NEW_UI or NEW_IMPORTS is off. */
export default async function ImportShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isNewUiEnabled() || !isNewImportsEnabled() || (id !== "new" && !isValidUuid(id))) notFound();
  return <ImportShipmentPageClient id={id} />;
}
