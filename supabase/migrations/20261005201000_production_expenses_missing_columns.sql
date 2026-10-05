-- Add the production_expenses columns that create_production_expense_atomic() writes.
--
-- Running 20261005200000_expense_documents on 2026-10-05 showed that the live
-- production_expenses table has no finance_expense_id column. The table was
-- created from an early script, and later columns only exist in the hand-run
-- types/*.sql files. create_production_expense_atomic()
-- (20260909220000_ledger_payroll_integrity) inserts
--   description, expense_date, account_id, account_name, finance_expense_id,
--   finance_transaction_id, is_posted_to_finance, notes, created_by, created_by_name
-- so adding an expense from a production order fails with "column does not exist".
--
-- Every column is added only when missing and is nullable or has a default,
-- so existing rows are untouched. Idempotent: safe to run more than once.

BEGIN;

ALTER TABLE public.production_expenses
  ADD COLUMN IF NOT EXISTS description            TEXT,
  ADD COLUMN IF NOT EXISTS expense_date           DATE DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS account_id             UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS account_name           TEXT,
  ADD COLUMN IF NOT EXISTS finance_expense_id     UUID REFERENCES public.expenses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS finance_transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_posted_to_finance   BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS notes                  TEXT,
  ADD COLUMN IF NOT EXISTS created_by             UUID,
  ADD COLUMN IF NOT EXISTS created_by_name        TEXT;

UPDATE public.production_expenses
SET expense_date = (created_at AT TIME ZONE 'Asia/Baku')::date
WHERE expense_date IS NULL AND created_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_production_expenses_finance_expense
  ON public.production_expenses (finance_expense_id)
  WHERE finance_expense_id IS NOT NULL;

-- Expense documents (20261005200000) written by a production order take the
-- production date, description and cash row.
UPDATE public.expenses e
SET expense_date   = COALESCE(pe.expense_date, e.expense_date),
    transaction_id = COALESCE(e.transaction_id, pe.finance_transaction_id),
    description    = COALESCE(e.description, NULLIF(trim(pe.description), ''))
FROM public.production_expenses pe
WHERE pe.finance_expense_id = e.id;

COMMIT;
