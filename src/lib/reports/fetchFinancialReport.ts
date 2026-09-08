import { supabase } from "@/lib/supabase";
import {
  FINANCIAL_REPORT_SELECT_ATTEMPTS,
} from "@/lib/finance/transactionQueries";
import { isRetryableSelectError } from "@/lib/supabase/schemaFallback";
import { getTransactionDate, isDateInRange, resolveReportDateRange } from "@/lib/reports/dateRange";
import type { FinanceLedgerRow, FinancialReportData, ReportFilters } from "@/types/database.types";

export async function fetchFinancialReport(filters: ReportFilters): Promise<FinancialReportData> {
  const { startDate, endDate } = resolveReportDateRange(filters);

  let data: Record<string, unknown>[] | null = null;
  let lastError: string | null = null;

  for (const fields of FINANCIAL_REPORT_SELECT_ATTEMPTS) {
    const result = await supabase
      .from("transactions")
      .select(fields)
      .order("created_at", { ascending: false });

    if (!result.error) {
      data = (result.data || []) as Record<string, unknown>[];
      break;
    }

    lastError = result.error.message;
    if (!isRetryableSelectError(lastError)) break;
  }

  if (!data) {
    console.error("Financial report fetch error:", lastError);
    return {
      ledger: [],
      summary: { totalIncome: 0, totalExpense: 0, netFlow: 0, byCategory: [] },
    };
  }

  const rows: FinanceLedgerRow[] = [];
  const categoryTotals = new Map<string, { type: string; total: number }>();

  let totalIncome = 0;
  let totalExpense = 0;

  for (const tx of data) {
    const date = getTransactionDate(tx.created_at as string);
    if (!isDateInRange(date, startDate, endDate)) continue;

    const amount = Number(tx.amount) || 0;
    const type = (tx.type as string) || "-";
    const category = (tx.category as string) || "Digər";
    const isIncome = type === "Mədaxil";

    if (isIncome) totalIncome += amount;
    else totalExpense += amount;

    const catKey = `${type}::${category}`;
    const catEntry = categoryTotals.get(catKey) || { type, total: 0 };
    catEntry.total += amount;
    categoryTotals.set(catKey, catEntry);

    rows.push({
      id: tx.id as string,
      date,
      type,
      category,
      account_name: (tx.accounts as { name?: string } | null)?.name || "-",
      notes: (tx.notes as string) || null,
      amount,
      direction: isIncome ? "in" : "out",
    });
  }

  const byCategory = Array.from(categoryTotals.entries())
    .map(([key, val]) => {
      const category = key.split("::")[1] || "Digər";
      return { category, type: val.type, total: val.total };
    })
    .sort((a, b) => b.total - a.total);

  return {
    ledger: rows,
    summary: {
      totalIncome,
      totalExpense,
      netFlow: totalIncome - totalExpense,
      byCategory,
    },
  };
}
