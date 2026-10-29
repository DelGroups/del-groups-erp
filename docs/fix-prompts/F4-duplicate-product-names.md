# F4 — Duplicate product names: detect and warn

Check available skills, use every one that fits, and say which you used.

Branch: `saas/duplicate-product-names`. One PR, no push to main. Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code. Follow the SaaS program rules in CLAUDE.md.

## Problem

The database refuses a duplicate product `code` and `barcode` (`products_code_key`, `idx_products_code_unique`, `idx_products_barcode_unique`) but not a duplicate `name`. Production has products registered twice under the same name with different codes, for example:

- "Konik bar": codes `KON-S` (stock 194) and `Konik bar` (stock 182)
- "Qara 85 cm kvadrat": codes `MEM-85-KV-QA` and `Qara 85 cm kvadrat` (stock 1 each)

The second row of each pair looks like an import that put the name into the code column. If both are the same real item, its stock is counted twice.

## Do

1. **Stock integrity report.** In the same place as `duplicate_code` / `duplicate_barcode` (`stock_integrity_report()` in `supabase/migrations/20261028181000_product_stock_integrity.sql`, and the Settings › Stock integrity page), add a `duplicate_name` kind. Match on `lower(btrim(name))`, stockable products only, active products only. Never auto-fixable: list the products of a group together, with code, stock and a link to each. New migration `supabase/migrations/20261029300000_duplicate_product_names.sql` (this prefix is reserved: 20261029100000 is F1, 20261029200000 is F3; re-check `ls supabase/migrations` and open PRs before using it), `create or replace` only, no data changes.
2. **Warning when creating or editing a product**: ProductForm, quick scan, and the product import. If another product has the same normalised name, show a warning with the existing product (code, stock, link). The user may still save (warning, not a block); in the import, list the duplicates in the preview and let the user skip those rows. Do not add a unique constraint on name, the same name can be legitimate.
3. **Import check**: also flag rows whose `code` equals their own `name` (the pattern above) as "code looks like a name" in the preview.
4. Add the same check to `supabase/scripts/product_integrity_check.sql`.
5. Every UI string through src/i18n (az, en, ru).
6. Tests: SQL test in `supabase/tests/` (add to CI like the others), a unit test for the name normalisation helper and for the import preview.
7. Run `npm run lint` (only your files must be clean), `npm test`, `npm run build`.

## Do not

- Merge, delete or edit existing products, and do not run SQL on production. The two pairs above are for Del to review by hand.
- Fix unrelated problems; list them in the PR.

## PR

Plain-words description, how it was tested, and the manual step for Del (run the new migration on the test project, then production, in the SQL Editor; Run is enough).
