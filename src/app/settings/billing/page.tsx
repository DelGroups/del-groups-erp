import { notFound } from "next/navigation";
import { billingPageEnabled } from "@/lib/billing/overview";
import { isMultiTenant } from "@/lib/tenant/server";
import PageClient from "./page.client";

export const dynamic = "force-dynamic";

/** Settings → Billing (prompt 13): only with NEXT_PUBLIC_BILLING_PAGE_ENABLED=true and a control plane. */
export default function Page() {
  if (!billingPageEnabled(process.env) || !isMultiTenant()) notFound();
  return <PageClient />;
}
