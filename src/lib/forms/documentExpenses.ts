export interface DocumentAdditionalExpense {
  id: string;
  label: string;
  amount: number;
  paid_immediately: boolean;
  account_id: string;
}

export function createEmptyDocumentExpense(): DocumentAdditionalExpense {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    label: "",
    amount: 0,
    paid_immediately: false,
    account_id: "",
  };
}

export function sumDocumentAdditionalExpenses(expenses: DocumentAdditionalExpense[]): number {
  return expenses.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
}

export function validateDocumentAdditionalExpenses(
  expenses: DocumentAdditionalExpense[]
): string | null {
  for (const row of expenses) {
    const amount = Number(row.amount) || 0;
    if (amount <= 0) continue;
    if (row.paid_immediately && !row.account_id?.trim()) {
      return "Ödənilən əlavə xərc üçün kassa/bank hesabı seçilməlidir";
    }
  }
  return null;
}

export function documentExpensesToRpcPayload(expenses: DocumentAdditionalExpense[]) {
  return expenses
    .filter((row) => (Number(row.amount) || 0) > 0 && row.label.trim())
    .map((row) => ({
      id: row.id,
      label: row.label.trim(),
      amount: Number(row.amount) || 0,
      paid_immediately: Boolean(row.paid_immediately),
      account_id: row.paid_immediately ? row.account_id.trim() || null : null,
    }));
}
