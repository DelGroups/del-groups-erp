-- Unify "Stok Qəbulu" and "İlkin Qalıqlar" into a single Stok Girişi və İlkin Qalıq
-- document type. Documents can now represent either an opening balance or an
-- ordinary stock receipt, distinguished by entry_type.

ALTER TABLE public.inventory_initial_balances
  ADD COLUMN IF NOT EXISTS entry_type TEXT NOT NULL DEFAULT 'opening_balance'
    CHECK (entry_type IN ('opening_balance', 'receipt'));

CREATE INDEX IF NOT EXISTS idx_inventory_initial_balances_entry_type
  ON public.inventory_initial_balances (entry_type, doc_date DESC);
