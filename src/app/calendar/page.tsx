import { notFound } from "next/navigation";
import { isNewUiEnabled } from "@/lib/features/newUi";
import CalendarNewUiOnly from "./page.client";

export const dynamic = "force-dynamic";

/** Calendar (phase 20) exists only in the new UI: with NEW_UI off (production) the page is a 404. */
export default function CalendarPage() {
  if (!isNewUiEnabled()) notFound();
  return <CalendarNewUiOnly />;
}
