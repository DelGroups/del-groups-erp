"use server";

import { ActionAuthError } from "@/lib/auth/serverActionAuth";
import { ledgerClient, requirePartnerLedgers } from "@/lib/features/partnerLedgersServer";
import {
  BALANCE_SORTS,
  TURNOVER_SORTS,
  filtersJson,
  mapBalanceReport,
  mapTurnoverReport,
  type BalanceReport,
  type DebtorQuery,
  type TurnoverReport,
} from "@/lib/reports/debtorReport";

type Result<T> = { success: true; data: T } | { success: false; error: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** An export reads every row in one call (the RPC caps a page at 10,000). */
const EXPORT_LIMIT = 10000;

function paging(q: DebtorQuery, all: boolean): { limit: number; offset: number } {
  if (all) return { limit: EXPORT_LIMIT, offset: 0 };
  const size = Math.min(Math.max(Math.floor(q.pageSize) || 50, 1), 100);
  return { limit: size, offset: (Math.max(Math.floor(q.page) || 1, 1) - 1) * size };
}

/** Debtors / creditors / net as of a date: one RPC call (rows, count, totals, KPI strip). */
export async function fetchBalanceReportAction(q: DebtorQuery, all = false): Promise<Result<BalanceReport>> {
  try {
    await requirePartnerLedgers();
    if (q.tab === "turnover" || !DATE_RE.test(q.asOf) || !(BALANCE_SORTS as readonly string[]).includes(q.sort)) {
      return { success: false, error: "debtorReports.errors.badQuery" };
    }
    const { limit, offset } = paging(q, all);
    const db = await ledgerClient();
    const { data, error } = await db.rpc("get_debtor_creditor_report", {
      p_as_of: q.asOf,
      p_tab: q.tab,
      p_filters: filtersJson(q),
      p_sort: q.sort,
      p_dir: q.dir === "asc" ? "asc" : "desc",
      p_limit: limit,
      p_offset: offset,
    });
    if (error) return { success: false, error: "debtorReports.errors.load" };
    return { success: true, data: mapBalanceReport(data) };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: "debtorReports.errors.load" };
  }
}

/** Turnover per partner for a period, with DSO / DPO: one RPC call. */
export async function fetchTurnoverReportAction(q: DebtorQuery, all = false): Promise<Result<TurnoverReport>> {
  try {
    await requirePartnerLedgers();
    if (!DATE_RE.test(q.from) || !DATE_RE.test(q.to) || q.from > q.to || !(TURNOVER_SORTS as readonly string[]).includes(q.sort)) {
      return { success: false, error: "debtorReports.errors.badQuery" };
    }
    const { limit, offset } = paging(q, all);
    const db = await ledgerClient();
    const { data, error } = await db.rpc("get_partner_turnover", {
      p_from: q.from,
      p_to: q.to,
      p_filters: filtersJson(q),
      p_sort: q.sort,
      p_dir: q.dir === "asc" ? "asc" : "desc",
      p_limit: limit,
      p_offset: offset,
    });
    if (error) return { success: false, error: "debtorReports.errors.load" };
    return { success: true, data: mapTurnoverReport(data) };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: "debtorReports.errors.load" };
  }
}

/** Active users for the "created by / salesperson" filter (id and name only). */
export async function fetchReportPeopleAction(): Promise<Result<{ id: string; name: string }[]>> {
  try {
    await requirePartnerLedgers();
    const db = await ledgerClient();
    const { data, error } = await db.from("profiles").select("id, full_name, email").neq("is_active", false).order("full_name");
    if (error) return { success: false, error: "debtorReports.errors.load" };
    return {
      success: true,
      data: ((data ?? []) as { id: string; full_name: string | null; email: string | null }[]).map((p) => ({
        id: p.id,
        name: (p.full_name ?? "").trim() || (p.email ?? "").split("@")[0] || "—",
      })),
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: "debtorReports.errors.load" };
  }
}
