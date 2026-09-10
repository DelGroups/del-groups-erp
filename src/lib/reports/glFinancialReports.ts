export type GlAccountBalanceRow = {
  code: string;
  name: string;
  balance: number;
};

export type GlProfitAndLossSummary = {
  totalRevenue: number;
  totalCogs: number;
  totalExpenses: number;
  grossProfit: number;
  netProfit: number;
};

export type GlBalanceSheetSummary = {
  asOfDate: string;
  assets: GlAccountBalanceRow[];
  liabilities: GlAccountBalanceRow[];
  equityAccounts: GlAccountBalanceRow[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquityAccounts: number;
  netIncomeYtd: number;
  totalEquity: number;
};

export type GlGeneralLedgerRow = {
  lineId: string;
  entryId: string;
  entryDate: string;
  documentType: string;
  description: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  partnerId: string | null;
  debit: number;
  credit: number;
};

export type GlGeneralLedgerResult = {
  rows: GlGeneralLedgerRow[];
  total: number;
  limit: number;
  offset: number;
};

export type GlFinancialReportsData = {
  profitAndLoss: GlProfitAndLossSummary;
  balanceSheet: GlBalanceSheetSummary;
  generalLedger: GlGeneralLedgerResult;
};

export type GlFinancialReportsQuery = {
  startDate: string;
  endDate: string;
  accountId?: string | null;
  partnerId?: string | null;
  ledgerLimit?: number;
  ledgerOffset?: number;
};

function toAmount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapBalanceRows(value: unknown): GlAccountBalanceRow[] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => {
    const item = row as Record<string, unknown>;
    return {
      code: String(item.code || ""),
      name: String(item.name || ""),
      balance: toAmount(item.balance),
    };
  });
}

export function mapPlSummary(payload: unknown): GlProfitAndLossSummary {
  const data = (payload || {}) as Record<string, unknown>;
  const totalRevenue = toAmount(data.total_revenue);
  const totalCogs = toAmount(data.total_cogs);
  const totalExpenses = toAmount(data.total_expenses);
  const grossProfit = totalRevenue - totalCogs;
  const netProfit = totalRevenue - totalCogs - totalExpenses;
  return {
    totalRevenue,
    totalCogs,
    totalExpenses,
    grossProfit,
    netProfit,
  };
}

export function mapBalanceSheet(payload: unknown): GlBalanceSheetSummary {
  const data = (payload || {}) as Record<string, unknown>;
  return {
    asOfDate: String(data.as_of_date || ""),
    assets: mapBalanceRows(data.assets),
    liabilities: mapBalanceRows(data.liabilities),
    equityAccounts: mapBalanceRows(data.equity_accounts),
    totalAssets: toAmount(data.total_assets),
    totalLiabilities: toAmount(data.total_liabilities),
    totalEquityAccounts: toAmount(data.total_equity_accounts),
    netIncomeYtd: toAmount(data.net_income_ytd),
    totalEquity: toAmount(data.total_equity),
  };
}

export function mapGeneralLedger(payload: unknown): GlGeneralLedgerResult {
  const data = (payload || {}) as Record<string, unknown>;
  const rowsRaw = Array.isArray(data.rows) ? data.rows : [];
  const rows: GlGeneralLedgerRow[] = rowsRaw.map((row) => {
    const item = row as Record<string, unknown>;
    return {
      lineId: String(item.line_id || ""),
      entryId: String(item.entry_id || ""),
      entryDate: String(item.entry_date || ""),
      documentType: String(item.document_type || ""),
      description: String(item.description || ""),
      accountId: String(item.account_id || ""),
      accountCode: String(item.account_code || ""),
      accountName: String(item.account_name || ""),
      partnerId: typeof item.partner_id === "string" ? item.partner_id : null,
      debit: toAmount(item.debit),
      credit: toAmount(item.credit),
    };
  });

  return {
    rows,
    total: toAmount(data.total),
    limit: toAmount(data.limit) || 50,
    offset: toAmount(data.offset),
  };
}
