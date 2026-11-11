"use server";

import { ActionAuthError } from "@/lib/auth/serverActionAuth";
import { mapPartnerStatement, type PartnerStatement, type StatementSide } from "@/lib/reports/partnerStatement";
import { ledgerClient, requirePartnerLedgers } from "@/lib/features/partnerLedgersServer";

export type PartnerStatementResult = { success: true; data: PartnerStatement } | { success: false; error: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One partner's statement from the LED-1 ledger (get_partner_statement), for a range and side. */
export async function fetchPartnerStatementAction(
  partnerId: string,
  from: string | null,
  to: string,
  side: StatementSide = "net"
): Promise<PartnerStatementResult> {
  try {
    await requirePartnerLedgers();
    if (!UUID_RE.test(partnerId)) return { success: false, error: "partnerStatement.errors.noPartner" };
    if ((from !== null && !DATE_RE.test(from)) || !DATE_RE.test(to) || (from !== null && from > to)) {
      return { success: false, error: "partnerStatement.errors.badRange" };
    }
    if (side !== "net" && side !== "receivable" && side !== "payable") return { success: false, error: "partnerStatement.errors.badRange" };
    // Service role: the permission is checked above (get_partner_statement trusts the service role).
    const db = await ledgerClient();
    const { data, error } = await db.rpc("get_partner_statement", { p_partner_id: partnerId, p_from: from, p_to: to, p_side: side });
    if (error) return { success: false, error: error.code === "P0002" ? "partnerStatement.errors.notFound" : "partnerStatement.errors.load" };
    return { success: true, data: mapPartnerStatement(data) };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: "partnerStatement.errors.load" };
  }
}

/** The partner of a customer or supplier (list deep links: ?customerId= / ?supplierId=). */
export async function resolveStatementPartnerAction(
  customerId: string | null,
  supplierId: string | null
): Promise<{ success: true; partnerId: string } | { success: false; error: string }> {
  try {
    await requirePartnerLedgers();
    const c = customerId && UUID_RE.test(customerId) ? customerId : null;
    const s = supplierId && UUID_RE.test(supplierId) ? supplierId : null;
    if (!c && !s) return { success: false, error: "partnerStatement.errors.noPartner" };
    const db = await ledgerClient();
    const { data, error } = await db.rpc("_partner_ledger_partner", { p_customer_id: c, p_supplier_id: s });
    if (error || !data) return { success: false, error: "partnerStatement.errors.notFound" };
    return { success: true, partnerId: String(data) };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: "partnerStatement.errors.load" };
  }
}
