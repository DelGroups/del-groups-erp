import { notFound } from "next/navigation";
import { isValidUuid } from "@/lib/auth/validate";
import { isNewUiEnabled } from "@/lib/features/newUi";
import { lotScreensVisible } from "@/lib/features/lotTrackingServer";
import LotCardPageClient from "./page.client";

export const dynamic = "force-dynamic";

/** One lot (LOT-4). 404 while NEW_UI or LOT_TRACKING is off for this user, or the id is not a uuid. */
export default async function LotCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isNewUiEnabled() || !isValidUuid(id) || !(await lotScreensVisible())) notFound();
  return <LotCardPageClient id={id} />;
}
