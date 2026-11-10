## پرامپت GUARD-2: داده محصول (اسم تکراری یا اشتباه) و چک‌های انبار

```text
Before starting, check the list of available skills. Use every skill that fits this task.
At the end, say which skills you used, or that none fit.

Task: add product master-data and stock rules to the Accounting Guard, and a "Find duplicate or wrong
product names" button. Branch: saas/accounting-guard-products. Requires GUARD-1 merged (pull main
first). Open a PR. Behind ACCOUNTING_GUARD, admin only.

Migration: one file <unique prefix>_accounting_guard_products.sql (suggested 20261120110000; check
first). It may enable pg_trgm: CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions.

Rules (seed in guard_rules, category 'products' or 'stock')
F1 exact same name: reuse the duplicate_name logic, do not copy it twice; call
   stock_integrity_report() or move the shared part into one helper used by both.
F2 similar name: a normalising function public.guard_normalize_name(text) IMMUTABLE (lower case,
   trim, collapse spaces, drop punctuation, Azerbaijani letters ə->e ı->i ö->o ü->u ş->s ç->c ğ->g,
   Cyrillic look-alike letters to Latin), then pairs with equal normalised name OR
   similarity() >= params.threshold (default 0.85). Group the pairs into clusters; one finding per
   cluster with every product's id, code, name, unit, category, stock and last movement date.
   Add a trigram index on the normalised name so the scan stays fast on 10k products.
F3 name stored in the code column / code in the name column, leading/trailing/double spaces.
F4 missing category or unit, zero sale or purchase price on a stockable product.
F5 duplicate code / barcode (reuse the existing kinds).
E1 every other stock_integrity_report() kind becomes a finding (no duplicated logic).
E2 negative stock in any warehouse; E3 sale of a product that had no stock on the document date;
E4 zero unit cost, or purchase price that jumped more than params.pct=50 vs the previous purchase;
E5 inventory count variance above params.pct.

UI
- On the product list (both old and new UI) and on /settings/stock-integrity: admin-only button
  "Find duplicate or wrong names" that runs guard_scan(ARRAY['products']) and opens a dialog/drawer
  listing clusters (code, name, stock, unit, category, last movement), each product name links to its
  card. Actions per cluster: "Not a duplicate" (false_positive, reason required) and "Open in
  Accounting Guard". No merge and no delete in this PR.
- Follow docs/ui-standard.md and docs/ui-library rules; every string through src/i18n (az, en, ru).

Tests: extend supabase/tests/accounting_guard.sql with cases for each rule (e.g. "Konik bar" vs
"konik  bar", "Ağac" vs "Agac", Cyrillic "а" vs Latin "a", and two genuinely different names that
must not match). Unit tests for any TS helper. Run npm run lint, npm test, npm run build.
PR description as in CLAUDE.md, with the SQL to run and the UI rule ids touched.
```
