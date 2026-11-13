import { isLotTrackingEnabled, lotTrackingActive, lotTrackingAudience } from "./lotTracking";
import { getServerAuthContext } from "@/lib/supabaseServer";
import { isAdminRole } from "@/types/database.types";

/**
 * LOT-4: the lot screens exist only while LOT_TRACKING is on for this user (its audience: admins
 * unless LOT_TRACKING_AUDIENCE=all). The route permission (lots.view) is checked by the proxy and
 * by every read; this decides 404 versus the page.
 */
export async function lotScreensVisible(): Promise<boolean> {
  if (!isLotTrackingEnabled()) return false;
  const audience = lotTrackingAudience();
  if (audience === "all") return true;
  const { profile } = await getServerAuthContext();
  return lotTrackingActive({ enabled: true, audience, isAdmin: isAdminRole(profile?.role) });
}
