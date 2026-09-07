-- journal_entry_lines may exist from an older deploy without line_memo.
-- post_journal_entry / post_cash_transaction require this column.

ALTER TABLE public.journal_entry_lines
  ADD COLUMN IF NOT EXISTS line_memo TEXT;

NOTIFY pgrst, 'reload schema';
