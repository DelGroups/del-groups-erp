import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerAuthContext } from "@/lib/supabaseServer";
import { isAdminRole } from "@/types/database.types";
import { isNewUiEnabled } from "@/lib/features/newUi";
import { loadBrandColor } from "@/design-system/server";
import { dsFont } from "@/design-system/fonts";
import DesignGallery from "./DesignGallery";

export const dynamic = "force-dynamic";

/**
 * /dev/design (prompt 15): every design-system component in light and dark, for admins only
 * and only while NEW_UI=true. Everyone else gets a 404, so the page is invisible in production.
 */
export default async function DesignPage() {
  if (!isNewUiEnabled()) notFound();
  const { client, user, profile, isActive } = await getServerAuthContext();
  if (!user || !isActive || !isAdminRole(profile?.role)) notFound();
  const brand = await loadBrandColor(client as unknown as SupabaseClient);
  return <DesignGallery brand={brand} fontClassName={dsFont.variable} />;
}
