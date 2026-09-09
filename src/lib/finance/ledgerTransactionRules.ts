import type { UnifiedLedgerTransaction } from "@/lib/finance/unifiedLedger";

export const LOCKED_LEDGER_REFERENCE_TYPES = new Set([
  "sale",
  "purchase",
  "production",
  "production_expense",
  "payroll",
  "employee_advance",
]);

export function getLedgerReferenceType(tx: UnifiedLedgerTransaction): string {
  return String(tx.reference_type || "").trim();
}

export function isLedgerTransactionLocked(tx: UnifiedLedgerTransaction): boolean {
  const source = getLedgerReferenceType(tx);
  return Boolean(source && LOCKED_LEDGER_REFERENCE_TYPES.has(source));
}

export function canEditLedgerTransaction(tx: UnifiedLedgerTransaction): boolean {
  return !isLedgerTransactionLocked(tx);
}

export function canDeleteLedgerTransaction(tx: UnifiedLedgerTransaction): boolean {
  return !isLedgerTransactionLocked(tx);
}
