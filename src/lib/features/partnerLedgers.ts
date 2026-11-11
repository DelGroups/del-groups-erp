/**
 * PARTNER_LEDGERS (LED-3): the partner statement ("Hesab çıxarışı") and, later, the debtor /
 * creditor reports, all built on the LED-1 partner ledger. Server-only switch, off unless the env
 * value is "true". PARTNER_LEDGERS_AUDIENCE: "admins" (default) shows them to admins only, "all"
 * to everyone. Either way only users with can_view_financial_reports ever see them. While off,
 * nothing changes: the partner page keeps its old Ledger tab, the reconciliation act its old
 * source, and /dashboard/reports/partner-statement is a 404.
 */
export type PartnerLedgersAudience = "admins" | "all";

export function isPartnerLedgersEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return (env.PARTNER_LEDGERS ?? "").trim().toLowerCase() === "true";
}

export function partnerLedgersAudience(env: Readonly<Record<string, string | undefined>> = process.env): PartnerLedgersAudience {
  return (env.PARTNER_LEDGERS_AUDIENCE ?? "").trim().toLowerCase() === "all" ? "all" : "admins";
}

/** Does this user get the partner ledger pages? */
export function partnerLedgersActive(input: {
  enabled: boolean;
  audience: PartnerLedgersAudience;
  isAdmin: boolean;
  canViewFinancialReports: boolean;
}): boolean {
  return input.enabled && input.canViewFinancialReports && (input.audience === "all" || input.isAdmin);
}
