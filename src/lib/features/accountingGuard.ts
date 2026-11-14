/**
 * ACCOUNTING_GUARD (GUARD-1..5): the Accounting Guard, a read-only rule engine that scans the
 * ledger and the documents for errors and suspicious entries (docs/accounting-guard-plan.md).
 * Server-only switch, off unless the env value is "true". Admins only: the guard section, its
 * buttons and the manual scan are shown only to admins (isAdminRole), and the database functions
 * (guard_scan, guard_set_finding_status, the guard_* tables) refuse everyone else.
 *
 * The database part (20261120100000_accounting_guard_core.sql) only reads business data and only
 * writes its own guard_* tables; nothing runs by itself until GUARD-4 schedules it, so merging it
 * changes nothing for staff.
 */
export function isAccountingGuardEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return (env.ACCOUNTING_GUARD ?? "").trim().toLowerCase() === "true";
}

/** Does this user get the Accounting Guard? Only an admin, and only with the flag on. */
export function accountingGuardActive(input: { enabled: boolean; isAdmin: boolean }): boolean {
  return input.enabled && input.isAdmin;
}

/** The rule categories of guard_rules.category; a scan scope is a list of these and / or rule codes. */
export const ACCOUNTING_GUARD_CATEGORIES = ["ledger", "documents", "cash", "partners"] as const;
export type AccountingGuardCategory = (typeof ACCOUNTING_GUARD_CATEGORIES)[number];

/** Finding statuses of guard_findings.status. */
export const ACCOUNTING_GUARD_STATUSES = ["open", "acknowledged", "resolved", "auto_resolved", "false_positive"] as const;
export type AccountingGuardStatus = (typeof ACCOUNTING_GUARD_STATUSES)[number];
