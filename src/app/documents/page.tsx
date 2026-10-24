import { notFound } from "next/navigation";
import { isNewUiEnabled } from "@/lib/features/newUi";
import DocumentsNewUiOnly from "./page.client";

export const dynamic = "force-dynamic";

/** Documents (phase 23) exists only in the new UI: with NEW_UI off (production) the page is a 404. */
export default function DocumentsPage() {
  if (!isNewUiEnabled()) notFound();
  return <DocumentsNewUiOnly />;
}
