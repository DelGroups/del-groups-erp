export type TrialBalanceRow = {
  accountId: string;
  code: string;
  name: string;
  accountType: string;
  initialDebit: number;
  initialCredit: number;
  periodDebit: number;
  periodCredit: number;
  closingDebit: number;
  closingCredit: number;
};

export type TrialBalanceTotals = {
  initialDebit: number;
  initialCredit: number;
  periodDebit: number;
  periodCredit: number;
  closingDebit: number;
  closingCredit: number;
};

export type TrialBalanceReport = {
  startDate: string;
  endDate: string;
  rows: TrialBalanceRow[];
  totals: TrialBalanceTotals;
};

function toAmount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function mapTrialBalance(payload: unknown): TrialBalanceReport {
  const data = (payload || {}) as Record<string, unknown>;
  const rowsRaw = Array.isArray(data.rows) ? data.rows : [];
  const totalsRaw = (data.totals || {}) as Record<string, unknown>;

  const rows: TrialBalanceRow[] = rowsRaw.map((row) => {
    const item = row as Record<string, unknown>;
    return {
      accountId: String(item.account_id || ""),
      code: String(item.code || ""),
      name: String(item.name || ""),
      accountType: String(item.account_type || ""),
      initialDebit: toAmount(item.initial_debit),
      initialCredit: toAmount(item.initial_credit),
      periodDebit: toAmount(item.period_debit),
      periodCredit: toAmount(item.period_credit),
      closingDebit: toAmount(item.closing_debit),
      closingCredit: toAmount(item.closing_credit),
    };
  });

  return {
    startDate: String(data.start_date || ""),
    endDate: String(data.end_date || ""),
    rows,
    totals: {
      initialDebit: toAmount(totalsRaw.initial_debit),
      initialCredit: toAmount(totalsRaw.initial_credit),
      periodDebit: toAmount(totalsRaw.period_debit),
      periodCredit: toAmount(totalsRaw.period_credit),
      closingDebit: toAmount(totalsRaw.closing_debit),
      closingCredit: toAmount(totalsRaw.closing_credit),
    },
  };
}

export function isZeroTrialBalanceRow(row: TrialBalanceRow): boolean {
  return (
    row.initialDebit === 0 &&
    row.initialCredit === 0 &&
    row.periodDebit === 0 &&
    row.periodCredit === 0 &&
    row.closingDebit === 0 &&
    row.closingCredit === 0
  );
}
