/**
 * Dunning (prompt 13, plan §4.4): what an unpaid invoice does to the tenant. Pure.
 *
 *   due date            last day to pay; nothing changes
 *   1 … grace days late past_due   full access, reminder email
 *   then, for suspend_after_days   read_only   reading and exports only (src/proxy.ts)
 *   after that                     suspended   "account suspended" page
 *   paid                           active      automatically, at once
 *
 * The oldest unpaid invoice decides. Defaults (billing_settings): grace 7 days, suspended
 * 30 days after read-only began. Statuses an admin set by hand (status_source = 'admin')
 * are never lifted automatically, and billing_paused_until holds dunning back.
 */
import { daysBetween } from "./pricing.ts";
import type { BillingSettings } from "./invoicing.ts";

export const DUNNING_STATUSES = ["active", "past_due", "read_only", "suspended"] as const;
export type DunningStatus = (typeof DUNNING_STATUSES)[number];

/** Statuses dunning moves a tenant between (and from trial into dunning). */
const MANAGED = new Set(["trial", "active", "past_due", "read_only", "suspended"]);
const RESTRICTED = new Set(["past_due", "read_only", "suspended"]);

/** The status for an invoice `daysOverdue` days past its due date (0 or less = not late). */
export function dunningStage(daysOverdue: number, settings: Pick<BillingSettings, "graceDays" | "suspendAfterDays">): DunningStatus {
  if (daysOverdue <= 0) return "active";
  if (daysOverdue <= settings.graceDays) return "past_due";
  if (daysOverdue <= settings.graceDays + settings.suspendAfterDays) return "read_only";
  return "suspended";
}

export interface UnpaidInvoice {
  id: string;
  dueDate: string | null;
}

export interface DunningInput {
  tenantStatus: string;
  statusSource: "admin" | "billing";
  pausedUntil: string | null;
  unpaid: readonly UnpaidInvoice[];
  /** Last paid invoice, for the "reactivated" email. */
  lastPaidInvoiceId: string | null;
  today: string;
  settings: Pick<BillingSettings, "graceDays" | "suspendAfterDays">;
}

export interface DunningDecision {
  /** New status, or null to leave the tenant as it is. */
  status: DunningStatus | null;
  /** The invoice the step is about (its email goes out once per invoice and step). */
  invoiceId: string | null;
  daysOverdue: number;
  /** Email to send with the change. */
  email: "past_due" | "read_only" | "suspended" | "reactivated" | null;
}

const NONE = (daysOverdue = 0): DunningDecision => ({ status: null, invoiceId: null, daysOverdue, email: null });

export function decideDunning(input: DunningInput): DunningDecision {
  const { tenantStatus, statusSource, today } = input;
  if (!MANAGED.has(tenantStatus)) return NONE();

  const overdue = input.unpaid
    .filter((i): i is UnpaidInvoice & { dueDate: string } => Boolean(i.dueDate) && i.dueDate! < today)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.id < b.id ? -1 : 1));

  if (!overdue.length) {
    // Everything late is paid: lift what billing imposed, never what an admin set.
    if (RESTRICTED.has(tenantStatus) && statusSource === "billing") {
      return { status: "active", invoiceId: input.lastPaidInvoiceId, daysOverdue: 0, email: "reactivated" };
    }
    return NONE();
  }

  const oldest = overdue[0];
  const daysOverdue = daysBetween(oldest.dueDate, today);
  if (input.pausedUntil && today <= input.pausedUntil) return NONE(daysOverdue);
  if (RESTRICTED.has(tenantStatus) && statusSource === "admin") return NONE(daysOverdue);

  const stage = dunningStage(daysOverdue, input.settings);
  if (stage === tenantStatus || stage === "active") return NONE(daysOverdue);
  return { status: stage, invoiceId: oldest.id, daysOverdue, email: stage };
}
