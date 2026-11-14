import { notFound } from "next/navigation";
import { isValidUuid } from "@/lib/auth/validate";
import { isNewUiEnabled } from "@/lib/features/newUi";
import { lotScreensVisible } from "@/lib/features/lotTrackingServer";
import LotsPageClient from "./page.client";

export const dynamic = "force-dynamic";

/** Lots (LOT-4): new UI only and behind LOT_TRACKING; otherwise a 404. ?product=<id> limits it to one product. */
export default async function LotsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isNewUiEnabled() || !(await lotScreensVisible())) notFound();
  const raw = (await searchParams).product;
  const product = typeof raw === "string" && isValidUuid(raw) ? raw : null;
  return <LotsPageClient productId={product} />;
}
