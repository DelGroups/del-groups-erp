import { Suspense } from "react";
import { notFound } from "next/navigation";
import GuardPage from "@/components/guard/GuardPage";
import { isAccountingGuardEnabled } from "@/lib/features/accountingGuard";
import { getServerAuthContext } from "@/lib/supabaseServer";
import { isAdminRole } from "@/types/database.types";

export const dynamic = "force-dynamic";

/** The Accounting Guard section (GUARD-3): admins only, and only with ACCOUNTING_GUARD on; otherwise a 404. */
export default async function Page() {
  if (!isAccountingGuardEnabled()) notFound();
  const { profile } = await getServerAuthContext();
  if (!isAdminRole(profile?.role)) notFound();
  return (
    <Suspense fallback={null}>
      <GuardPage />
    </Suspense>
  );
}
