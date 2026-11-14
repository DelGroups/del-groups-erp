import { notFound } from "next/navigation";
import { getServerAuthContext } from "@/lib/supabaseServer";
import { isAdminRole } from "@/types/database.types";
import { isAssistantV2On } from "@/lib/assistant/config";
import { isUiLabOpen } from "@/lib/features/uiStandard";
import { dsFont } from "@/design-system/fonts";
import AvatarReview from "./AvatarReview";

export const dynamic = "force-dynamic";

/**
 * /settings/dev/avatar (AST-2): every state of the assistant's avatar in its three sizes, with and without
 * reduced motion, and the panel with sample content, for review. Admins only, and only while ASSISTANT_V2
 * is on; under `next dev` with UI_LAB_OPEN=true it opens without signing in (screenshots).
 */
export default async function AvatarReviewPage({ searchParams }: { searchParams: Promise<{ theme?: string }> }) {
  if (!isUiLabOpen()) {
    if (!isAssistantV2On()) notFound();
    const { user, profile, isActive } = await getServerAuthContext();
    if (!user || !isActive || !isAdminRole(profile?.role)) notFound();
  }
  const { theme } = await searchParams;
  return <AvatarReview fontClassName={dsFont.variable} theme={theme === "light" || theme === "dark" ? theme : undefined} />;
}
