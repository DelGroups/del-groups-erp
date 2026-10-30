import { notFound } from "next/navigation";
import { getServerAuthContext } from "@/lib/supabaseServer";
import { isAdminRole } from "@/types/database.types";
import { isNewUiEnabled } from "@/lib/features/newUi";
import { isUiLabOpen, isUiStandardEnabled } from "@/lib/features/uiStandard";
import { dsFont } from "@/design-system/fonts";
import UiLab from "./UiLab";

export const dynamic = "force-dynamic";

/**
 * /dev/ui-lab (UI-1): every shared component of the UI standard with long Azerbaijani and Russian
 * texts, in 280/360/768/1280 px, both densities, light and dark. Same gate as /dev/design (admins,
 * NEW_UI on); `npm run ui:guard` opens it under `next dev` with UI_LAB_OPEN=true.
 */
export default async function UiLabPage() {
  if (!isUiLabOpen()) {
    if (!isNewUiEnabled()) notFound();
    const { user, profile, isActive } = await getServerAuthContext();
    if (!user || !isActive || !isAdminRole(profile?.role)) notFound();
  }
  return <UiLab fontClassName={dsFont.variable} standard={isUiStandardEnabled()} />;
}
