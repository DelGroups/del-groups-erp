import { notFound } from "next/navigation";
import { isLotTrackingEnabled } from "@/lib/features/lotTracking";
import { LotSettingsPage } from "@/modules/inventory/pages";

export const dynamic = "force-dynamic";

/** LOT-3: Settings > Lots (admins; LOT_TRACKING). */
export default function Page() {
  if (!isLotTrackingEnabled()) notFound();
  return <LotSettingsPage />;
}
