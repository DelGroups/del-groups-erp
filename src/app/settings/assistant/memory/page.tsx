import { notFound } from "next/navigation";
import { isAssistantV2On } from "@/lib/assistant/config";
import PageClient from "./page.client";

export const dynamic = "force-dynamic";

/** AST-3: what Del Assistant remembers (admins only; ASSISTANT_V2). RLS shows the notes to admins only. */
export default function Page() {
  if (!isAssistantV2On()) notFound();
  return <PageClient />;
}
