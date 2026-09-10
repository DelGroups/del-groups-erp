export type ReconciliationLine = {
  entryDate: string;
  documentNo: string;
  documentType: string;
  ourDebit: number;
  ourCredit: number;
  runningBalance: number;
};

export type PartnerReconciliationReport = {
  partnerId: string;
  partnerName: string;
  startDate: string;
  endDate: string;
  initialBalance: number;
  closingBalance: number;
  lines: ReconciliationLine[];
};

function toAmount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function mapPartnerReconciliation(payload: unknown): PartnerReconciliationReport {
  const data = (payload || {}) as Record<string, unknown>;
  const linesRaw = Array.isArray(data.lines) ? data.lines : [];

  const lines: ReconciliationLine[] = linesRaw.map((row) => {
    const item = row as Record<string, unknown>;
    return {
      entryDate: String(item.entry_date || ""),
      documentNo: String(item.document_no || ""),
      documentType: String(item.document_type || ""),
      ourDebit: toAmount(item.our_debit),
      ourCredit: toAmount(item.our_credit),
      runningBalance: toAmount(item.running_balance),
    };
  });

  return {
    partnerId: String(data.partner_id || ""),
    partnerName: String(data.partner_name || ""),
    startDate: String(data.start_date || ""),
    endDate: String(data.end_date || ""),
    initialBalance: toAmount(data.initial_balance),
    closingBalance: toAmount(data.closing_balance),
    lines,
  };
}
