import { notFound } from "next/navigation";
import { isDocDateChangeEnabled } from "@/lib/features/docDateChange";
import PageClient from "./page.client";

export const dynamic = "force-dynamic";

/** DATE-1: history of date changes of posted invoices (admins; DOC_DATE_CHANGE). */
export default function Page() {
  if (!isDocDateChangeEnabled()) notFound();
  return <PageClient />;
}
