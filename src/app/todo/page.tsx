import { notFound } from "next/navigation";
import { isNewUiEnabled } from "@/lib/features/newUi";
import TodoNewUiOnly from "./page.client";

export const dynamic = "force-dynamic";

/** To-do (phase 22) exists only in the new UI: with NEW_UI off (production) the page is a 404. */
export default function TodoPage() {
  if (!isNewUiEnabled()) notFound();
  return <TodoNewUiOnly />;
}
