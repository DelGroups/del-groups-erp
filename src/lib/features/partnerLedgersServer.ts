// Server code only (actions and server pages import it).
import type { SupabaseClient } from "@supabase/supabase-js";
import { ActionAuthError, requirePermissionAction, type ActionAuthContext } from "@/lib/auth/serverActionAuth";
import { getServerAuthContext } from "@/lib/supabaseServer";
import { userHasPermission } from "@/lib/auth/routePermissions";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { isPartnerLedgersEnabled, partnerLedgersActive, partnerLedgersAudience } from "@/lib/features/partnerLedgers";
import { isAdminRole } from "@/types/database.types";

/** PARTNER_LEDGERS on, the audience includes this user, and can_view_financial_reports (actions). */
export async function requirePartnerLedgers(): Promise<ActionAuthContext> {
  if (!isPartnerLedgersEnabled()) throw new ActionAuthError("partnerStatement.errors.disabled");
  const ctx = await requirePermissionAction("can_view_financial_reports");
  const allowed = partnerLedgersActive({
    enabled: true,
    audience: partnerLedgersAudience(),
    isAdmin: isAdminRole(ctx.profile?.role),
    canViewFinancialReports: true,
  });
  if (!allowed) throw new ActionAuthError("partnerStatement.errors.disabled");
  return ctx;
}

/** The same rule without throwing, for pages (a 404 when false) and the reconciliation act's source. */
export async function partnerLedgersActiveForRequest(): Promise<boolean> {
  if (!isPartnerLedgersEnabled()) return false;
  const { user, profile } = await getServerAuthContext();
  if (!user || profile?.is_active === false) return false;
  return partnerLedgersActive({
    enabled: true,
    audience: partnerLedgersAudience(),
    isAdmin: isAdminRole(profile?.role),
    canViewFinancialReports: userHasPermission(profile, "can_view_financial_reports"),
  });
}

/** The service-role client without generated RPC types (the ledger RPCs are newer than them). */
export async function ledgerClient(): Promise<SupabaseClient> {
  return (await createSupabaseAdminClient()) as unknown as SupabaseClient;
}
