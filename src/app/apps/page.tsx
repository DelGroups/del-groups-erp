import { notFound } from "next/navigation";
import { isNewUiEnabled } from "@/lib/features/newUi";
import PageClient from "./page.client";

export const dynamic = "force-dynamic";

/** App Launcher, the home of the new shell (prompt 16). 404 while NEW_UI is off. */
export default function AppsPage() {
  if (!isNewUiEnabled()) notFound();
  return <PageClient />;
}
