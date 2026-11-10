# پرامپت‌های LOT: ردیابی لوت / بچ و تاریخچه محصول

طرح کامل: [`LOT-plan.md`](LOT-plan.md). هر پرامپت را جدا در Claude Code (VS Code) اجرا کنید؛ هر کدام یک
شاخه و یک PR می‌سازد. ترتیب: LOT-1، بعد از merge آن LOT-2، بعد LOT-3، بعد LOT-4 و LOT-5 (این دو موازی هم می‌شوند).
SQL سه PR اول را با هم و به ترتیب روی production اجرا کنید (بخش ۱۲ طرح).

---

## LOT-1: هسته پایگاه داده لوت، backfill و یکپارچگی

```text
Before starting, check the list of available skills. Use every skill that fits this task.
At the end, say which skills you used, or that none fit.

Task: build the database core of a professional lot / batch tracking system (plan:
docs/lot-tracking/LOT-plan.md, read it fully first, sections 1-4, 11, 14). This PR adds the data
model, the automatic lot attribution of EVERY stock change, the backfill of today's stock and an
integrity check. No document flow passes lots yet (LOT-2 / LOT-3) and there is no UI except the
feature flag. Branch: saas/lot-core. Open a draft PR. Follow every rule in CLAUDE.md.

Context from the codebase (verify each point before relying on it):
- warehouse_stocks (product_id, warehouse_id nullable = default warehouse, current_stock) is the
  per-warehouse stock. stock_move / _stock_move_doc / adjust_warehouse_stock
  (20261029200000_stock_per_warehouse.sql, 20261028181000_product_stock_integrity.sql) change it;
  some paths write it directly (_inventory_count_set_stock, stock_integrity_fix, initial balance,
  src/lib/inventory/warehouseProductStock.ts). Treat NULL warehouse_id as stock_default_warehouse().
- Polywood (products.inventory_mode = 'polywood') stock follows polywood_pieces (length_m, status,
  warehouse_id, source_document_id); its warehouse_stocks rows are rebuilt from the pieces.
- inventory_batches / inventory_batch_consumptions are FIFO COST layers per product (no warehouse),
  consumed only by sales and inventory counts. Do NOT change them or any journal / COGS logic.
- stock_movements and inventory_batches get the document date via apply_document_date() /
  document_timestamp() (20261029100000_backdated_invoices_payments.sql).
- Numbering: document_number_counters (doc_type, year, last_no), see receive_import_shipment.
- audit_logs is purged by the retention setting; audit_alerts holds alerts.
- Permissions pattern: imports_can(text) in 20261030100000_imports_core.sql (admin, role
  permissions, overrides, _matrix). Feature flags: src/lib/features/*.ts (see newImports.ts).

1. Feature flag LOT_TRACKING in src/lib/features/lotTracking.ts (off unless "true"), plus an
   optional LOT_TRACKING_AUDIENCE=admins like NEW_HOME_AUDIENCE. Permissions lots.view and
   lots.manage in the permission matrix (inventory module manifest), admin has both. Unit tests.
2. Migration supabase/migrations/20261112100000_lot_core.sql (check `ls supabase/migrations` and
   open PRs first; pick another unique prefix if taken). One file, safe to re-run:
   a. Tables (RLS on; read with lots_can('view'); NO insert/update/delete policies: every write
      goes through SECURITY DEFINER functions):
      - stock_lots: id, lot_no text unique not null, product_id, supplier_batch_no, origin_type
        check in (import, purchase, opening, production, count_surplus, return, manual,
        unassigned), origin_doc_type, origin_doc_id, origin_line_id, origin_doc_no, supplier_id,
        import_shipment_id, customs_declaration_no, mfg_date, exp_date, received_date,
        qty_received, inventory_batch_id, status check in (active, quarantine, closed), notes,
        custom_fields jsonb default '{}', created_by, created_at, updated_at. One 'unassigned' lot
        per product (partial unique index). Indexes for FEFO picking: (product_id, status,
        exp_date nulls last, received_date, lot_no).
      - stock_lot_balances: lot_id, warehouse_id, qty, updated_at, PK (lot_id, warehouse_id);
        qty >= 0 except the unassigned lot. Index (warehouse_id, lot_id) where qty <> 0.
      - stock_lot_movements: immutable ledger. id, lot_id, product_id, warehouse_id, qty_delta
        (signed, never 0), balance_after, kind (in, out, transfer_in, transfer_out, reverse_in,
        reverse_out, correction), doc_type, doc_id, doc_line_id, doc_no, counterparty_type
        (customer, supplier, partner, employee, warehouse, none), counterparty_id, pick_mode
        (manual, fefo, fifo, reverse, mirror, new_lot, unassigned, backfill, no_context),
        reverses_movement_id, movement_date timestamptz (document date via apply_document_date),
        recorded_at default now(), created_by default auth.uid(). Indexes: (product_id,
        movement_date), (lot_id, movement_date), (doc_type, doc_id, doc_line_id).
      - stock_lot_events: lot_id, event (created, renamed, dates_changed, status_changed,
        note, corrected), old_values, new_values, reason, created_by, created_at. Permanent.
      - New columns: polywood_pieces.lot_id, polywood_pieces.parent_piece_id,
        inventory_batches.lot_id, products.lot_policy (auto | manual_required, default auto),
        products.shelf_life_days.
      - system_settings key lot_tracking: { number_format: 'LOT-{YYYY}-{NNNNN}', pick: 'fefo' }.
   b. lots_can(p_action) like imports_can; next_lot_no(p_date) using document_number_counters
      (doc_type 'lot', yearly) and the format setting.
   c. Lot context, transaction-local (set_config('erp.lot_ctx', ..., true)):
      lot_ctx_begin(p jsonb) / lot_ctx_end(). Fields: doc_type, doc_id, doc_line_id, doc_no,
      product_id, counterparty_type, counterparty_id, mode (normal | reverse | mirror),
      reverse_of {doc_type, doc_id, doc_line_id}, mirror_of {doc_type, doc_id, doc_line_id},
      lots [{lot_id | lot_no, qty}] chosen by the user, new_lot {lot_no?, supplier_batch_no,
      mfg_date, exp_date, origin_type, supplier_id, import_shipment_id, customs_declaration_no,
      inventory_batch_id}. A context whose product_id differs from the changed row is ignored.
   d. _lot_apply(product, warehouse, delta) and an AFTER INSERT / UPDATE OF current_stock,
      warehouse_id / DELETE trigger on warehouse_stocks that calls it with the row delta (skip
      services, kits and polywood). Rules (plan section 4):
      - in + mode reverse: give back to the lots the original document took (latest first, using
        its out movements minus earlier reversals), remainder as below.
      - in + mode mirror: same lots and quantities as the mirrored out movements (transfers).
      - in + chosen lots: those; in + new_lot or any document: a new lot (next_lot_no unless
        lot_no given), origin from the context; in with no context: the unassigned lot + alert.
      - out + chosen lots: those (remainder FEFO + alert); out + reverse: from the lots the
        original document put in; out otherwise: FEFO (exp_date, then received_date, lot_no)
        over active lots with qty > 0 in that warehouse; shortage: unassigned lot (may go
        negative) + an audit_alerts row 'lot_shortage'.
      - Every split writes one stock_lot_movements row per lot with balance_after.
      - It must NEVER raise for a normal stock change (wrap the body; on an unexpected error write
        an audit_alerts row 'lot_error' and let the stock change through). It must be fast.
   e. Polywood: triggers on polywood_pieces. INSERT of an available piece = in (length_m) to
      NEW.lot_id, else the parent piece's lot, else the context, else unassigned (set NEW.lot_id
      in a BEFORE trigger). Status leaving available (sold, used, deleted, …), length change,
      warehouse change = out / in / transfer of the length. Read the cutting code in
      process_mixed_dimensional_sale and every other INSERT INTO polywood_pieces (SQL and
      src/modules/polywood, src/lib/polywood) and make offcuts set parent_piece_id.
   f. Backfill (before creating the triggers): for every import receipt line and purchase line
      whose FIFO batch still has remaining_qty, create a lot (origin import / purchase, links,
      received_date = document date) with qty = LEAST(batch remaining_qty, stock still unassigned
      in that warehouse), oldest first; then one 'opening' lot per product x warehouse for the
      rest of warehouse_stocks.current_stock > 0; polywood pieces with source_document_id = an
      import receipt get that receipt's lot, the rest an opening lot per product x warehouse.
      Movements pick_mode 'backfill'. RAISE NOTICE the counts. Afterwards every product x
      warehouse must satisfy SUM(lot balances) = current_stock (and = available piece length for
      polywood); RAISE EXCEPTION if not.
   g. lot_integrity_report() (lots.view, admin sees all) and lot_integrity_fix(p_product,
      p_warehouse, p_reason) (admin only; posts 'correction' movements through the unassigned
      lot, logs stock_lot_events + audit_logs). Checks: sum mismatch, non-zero unassigned lot,
      negative balance, movements with pick_mode no_context in the last N days, lots past
      exp_date with stock.
   h. lot_update(p_lot_id, p_fields jsonb, p_reason) (lots.manage): supplier_batch_no, dates,
      notes, custom_fields; lot_no only while the lot has no out movement, else admin only with
      reason; lot_set_status(p_lot_id, p_status, p_reason). Both write stock_lot_events and
      audit_logs (module 'inventory').
   i. Grants: functions executable by authenticated only where they check lots_can themselves;
      internal ones (_lot_apply, triggers) revoked from public/anon/authenticated.
3. supabase/tests/lot_core.sql (pattern of supabase/tests/stock_per_warehouse.sql): backfill
   invariant, in/out FEFO/FIFO, chosen lots, reverse, mirror, unassigned + alert, polywood cut
   inheriting the lot, an unexpected error not blocking stock_move, integrity report and fix.
   Node test tests/lotCore.test.mjs for the flag and the migration text (no forbidden policies,
   trigger present, never-raise wrapper).
4. Update the module SQL ownership (supabase/modules/inventory/objects.json or the generator, as
   the repo does it) if new objects must be listed; run the checks the repo has for that.
5. Run npm run lint, npm test, npm run build; run the SQL test on a local or branch database
   (never production). Do not change any existing function except adding triggers.

PR description (CLAUDE.md rule 11, Persian summary + English details): what changed, how it was
tested, and the manual step: "Run 20261112100000_lot_core.sql on production ONLY together with
LOT-2 and LOT-3, in order, after all three are merged; then run lot_integrity_report() and
expect no rows." Say which ui-standard rules were touched (none expected). List unrelated
problems you find instead of fixing them.
```

---

## LOT-2: ورود کالا با لوت (واردات، خرید، اول دوره، تولید، شمارش) و برچسب

```text
Before starting, check the list of available skills. Use every skill that fits this task.
At the end, say which skills you used, or that none fit.

Task: every inbound stock document creates named lots (plan docs/lot-tracking/LOT-plan.md,
sections 2, 5, 7). Imports first and most carefully. Requires LOT-1 (saas/lot-core) merged: stop
and say so if supabase/migrations has no *_lot_core.sql. Branch: saas/lot-inbound. Draft PR.
Follow every rule in CLAUDE.md (read the relevant guide in node_modules/next/dist/docs/ first).

Context (verify): LOT-1 gives stock_lots, lot_ctx_begin/lot_ctx_end, next_lot_no, the triggers on
warehouse_stocks and polywood_pieces. receive_import_shipment (20261030110000_imports_posting.sql)
loops over p_lines: stock_move or polywood pieces, import_receipt_lines, stock_movements,
create_inventory_batch. Import UI: src/modules/imports/components (ImportLinesGrid,
ReceivingSheet, WarehouseSplitDrawer), save via import_shipment_save_draft (latest in
20261106100000_imports_duty_override.sql). Purchases: post_purchase_invoice_draft /
process_purchase_receipt_event (latest in 20261029200000_stock_per_warehouse.sql). Initial
balance, production ready event (finished goods), inventory_count_post (surplus).

1. Migration 20261112110000_lot_inbound.sql (check the prefix is free). Replace each function
   with the same signature (CREATE OR REPLACE, copy the latest body, change only the lot parts):
   - import_shipment_lines: lot_no_planned, supplier_batch_no, mfg_date, exp_date (draft only,
     written by import_shipment_save_draft from optional keys on each line; old callers keep
     working). Check lot_no_planned is unique against stock_lots and within the shipment.
   - receive_import_shipment: each p_lines entry may carry lots [{lot_no?, supplier_batch_no?,
     mfg_date?, exp_date?, qty_stock_unit}] summing to the entry's qty (else the line's planned
     values, one lot). Before each stock change call lot_ctx_begin with doc_type
     'import_receipt', doc_id receipt, doc_line_id receipt line, doc_no, counterparty supplier,
     new_lot {origin import, supplier_id, import_shipment_id, customs_declaration_no,
     inventory_batch_id}; lot_ctx_end after. A second receipt of the same shipment line adds to
     the SAME lot (same lot_no) unless the user gave another. Write import_receipt_lines.lot_id
     (new column) and inventory_batches.lot_id. Polywood sheets get lot_id on insert.
     Enforce products.lot_policy = 'manual_required' (supplier_batch_no and, with
     shelf_life_days, exp_date required; default exp_date = mfg_date + shelf_life_days).
   - cancel_import_shipment: reverse context (doc_type import_receipt) so stock leaves exactly
     the receipt lots; it already refuses when received stock was used.
   - Purchases (post + reverse), initial balance (post + unpost), production finished goods
     (origin production, lot_no from the order number when free, link the consumed material lots
     in custom_fields.material_lots from the order's out movements), inventory_count_post surplus
     (origin count_surplus) and inventory_count_unpost (reverse).
2. UI behind LOT_TRACKING (flag off = today's screens unchanged, no new keys sent):
   - ImportLinesGrid: Lot column group (lot no with an "auto" placeholder, supplier batch no,
     mfg / exp date); ReceivingSheet: prefilled lot fields per row and a "split into lots" action
     adding sub-rows (sum must equal the row, live validation); read-only lot chips on received
     lines linking to the lot card route /inventory/lots/[id] (the page comes in LOT-4; link only
     when the flag is on).
   - Purchase line and initial balance line: optional lot fields (same component).
   - After a receipt: "Print lot labels" (one label per lot, or per sheet for polywood): lot no as
     Code128 + QR, product, supplier batch, exp date, receipt no. Reuse the barcode / QR code the
     repo already uses for polywood pieces and products.
   - One shared typed component for the lot fields in src/modules/inventory (public API in
     src/modules/inventory/index.ts), used by imports and purchases through that API only.
3. All strings in src/i18n (az, en, ru). docs/ui-standard.md rules (forms, line grids).
4. Tests: supabase/tests/lot_inbound.sql (receipt with one lot, split lots, two receipts same
   lot, manual_required refusal, cancel reverse, purchase post/reverse, opening, production,
   count surplus/unpost, invariant after each); node tests for the lot fields component logic and
   payload building. npm run lint, npm test, npm run build.

PR description: plain words, tests, ui-standard rule ids, manual step "run with LOT-1 and LOT-3".
```

---

## LOT-3: خروج کالا با لوت، انتقال اتمی، لغو و برگشت

```text
Before starting, check the list of available skills. Use every skill that fits this task.
At the end, say which skills you used, or that none fit.

Task: every outbound and moving stock document records which lots it used, picked automatically
(FEFO, then FIFO) or chosen by the user, and every cancel / void / return gives back exactly
those lots (plan docs/lot-tracking/LOT-plan.md, sections 4, 6, 7). Requires LOT-1 merged (stop
otherwise); best after LOT-2. Branch: saas/lot-outbound. Draft PR. Follow every rule in CLAUDE.md.

Context (verify, latest bodies are mostly in 20261029200000_stock_per_warehouse.sql and
20261029100000_backdated_invoices_payments.sql): create_sale_atomic, post_sales_invoice_draft,
process_mixed_dimensional_sale (polywood), cancel_sales_invoice_atomic, _reverse_sales_invoice_
posting, restore_sale_stock, post_inventory_writeoff / update_inventory_writeoff, production
material issue / return_production_material_stock / delivery, create_consignment_dispatch_atomic /
settle_consignment_partner_atomic / consignment returns, inventory_count_post shortage, purchase
reverse. Stock transfers are written from TypeScript in
src/modules/inventory/lib/stockTransferServer.ts (not atomic).

1. Migration 20261112120000_lot_outbound.sql (check the prefix). CREATE OR REPLACE each function
   with the same signature, copying the latest body and adding only:
   - Per line: lot_ctx_begin(doc_type, doc_id, doc_line_id, doc_no, product, counterparty
     (customer for sales, partner for consignment, employee / order for production), lots
     chosen in the payload line key "lots": [{lot_id, qty}]) before the stock change, lot_ctx_end
     after. Validate chosen lots BEFORE moving stock: same product, available in the line's
     warehouse, not quarantine, quantities sum to the line quantity (stock unit); raise a clear
     Azerbaijani message naming product, lot and warehouse (like stock_shortage_message).
   - Kits: the component lines pick automatically.
   - Cancel / void / reverse / unpost / material return / consignment return: mode reverse with
     reverse_of = the original document (and line when known).
   - New RPC post_stock_transfer(p_payload jsonb): header + lines in one transaction (same
     tables and numbering the TS code uses today), out of the source with optional chosen lots,
     in to the target with mode mirror; polywood offcuts move their pieces (lot follows). The API
     route uses it when LOT_TRACKING is on, else the old path (so deploy order is safe).
   - Expired lots: chosen expired lot allowed only with lots.manage (warning in the UI); FEFO
     never picks quarantine lots.
2. UI behind LOT_TRACKING (flag off = no change, no "lots" key sent):
   - A typed LotPicker in src/modules/inventory (public API): Combobox of lots of the product in
     the line's warehouse with qty, supplier batch, exp date, status; FEFO suggestion first;
     split one line over several lots in a popover; expired / near-expiry / quarantine badges.
     Default is "Auto (FEFO)" so nobody has to pick.
   - Used in the sale form line grid, write-off form, stock transfer form, production material
     issue and consignment dispatch. Lot chips (read-only) on the posted documents' views.
   - Sales invoice print: lot numbers under each line when the setting
     lot_tracking.print_on_invoice is true (default false), in the settings page.
3. i18n (az, en, ru); docs/ui-standard.md (line grids, lookups, overlays).
4. Tests: supabase/tests/lot_outbound.sql: sale auto FEFO across two lots, sale with chosen lots,
   bad chosen lot refused before any stock moves, cancel and void restore the same lots, write-off
   update (reverse + re-apply), production issue and return, consignment dispatch / return /
   settle, transfer keeps lots (and polywood offcut), count shortage / unpost, purchase reverse,
   kit sale; invariant SUM(lot balances) = warehouse stock after each. Node tests for LotPicker
   allocation logic and the transfer route switch. npm run lint, npm test, npm run build.

PR description: plain words, tests, ui-standard rule ids, and the manual step: "After LOT-1,
LOT-2 and LOT-3 are merged run on production in this order: *_lot_core.sql, *_lot_inbound.sql,
*_lot_outbound.sql; then SELECT * FROM lot_integrity_report(); expect no rows." List unrelated
problems found.
```

---

## LOT-4: صفحه‌های لوت (لیست، کارت لوت، اسکن، موجودی انبار)

```text
Before starting, check the list of available skills. Use every skill that fits this task.
At the end, say which skills you used, or that none fit.

Task: the screens of the lot system, all behind LOT_TRACKING (plan docs/lot-tracking/
LOT-plan.md, section 9). Requires LOT-1..3 merged. Branch: saas/lot-ui. Draft PR. Follow every
rule in CLAUDE.md (read node_modules/next/dist/docs/ first; middleware is src/proxy.ts) and
docs/ui-standard.md (UI_STANDARD and UI_UNIFIED are on in production: use the unified page frame,
lists, overlays and tokens; check how the latest merged screens do it).

1. Inventory module routes (thin files in src/app, screens in src/modules/inventory):
   - /inventory/lots: list with search (lot no, supplier batch no, product name / code /
     barcode), filters (product, supplier, import shipment, warehouse, status, expiry window,
     has stock), column picker and saved views like the other lists, row menu (open, print
     label, quarantine / release, export). Excel and PDF export of the filtered rows with the
     export helper the repo already uses.
   - /inventory/lots/[id] lot card: header (lot no, product, supplier batch, status badge,
     dates, origin with links to the import shipment / receipt / purchase / production order,
     supplier, invoice no, customs declaration no); KPI tiles (received, on hand, sold, written
     off, at consignment partners, in production); balances per warehouse; tabs: Trace (backward
     origin chain; forward: customers with invoice links, qty, dates, grouped by customer),
     Movements (timeline of stock_lot_movements with running balance, document links, user,
     pick mode), History (stock_lot_events), Chatter (src/views/chatter). Unit cost only for
     users with the financial figures permission. Actions menu: edit (lot_update with reason),
     quarantine / release (lot_set_status), print label, export the card to PDF / Excel.
   - Warehouse stock page: expandable row per product showing its lots in that warehouse.
   - Products list row menu: "History" (opens the LOT-5 report prefiltered when it exists,
     else hide) and "Lots" (lots list filtered by product).
   - Barcode lookup (src/app/api/lookup-barcode) and the command palette / global search: a lot
     no or supplier batch no opens the lot card.
   - Navigation entry under Anbar via the inventory manifest, permission lots.view.
2. Server actions with requirePermissionAction / lots_can checks; reads through RPCs or views
   that respect RLS; pagination for movements (lots can have thousands).
3. Add a migration only if a read RPC or view is needed (20261112130000_lot_ui.sql, check the
   prefix); keep reads index-friendly.
4. i18n az / en / ru for every string. Accessibility and phone layout per ui-standard.
5. Tests: node tests for list filters, card data shaping, permission gating (financial figures
   hidden), barcode lookup of a lot, flag off = routes 404 and no menu items. Screenshots at
   1280 and phone width for the PR. npm run lint, npm test, npm run build.

PR description: plain words, tests, ui-standard rule ids touched and exceptions, manual step:
"set LOT_TRACKING=true and LOT_TRACKING_AUDIENCE=admins in .env.production when ready".
```

---

## LOT-5: گزارش‌ها — تاریخچه محصول، ردیابی و فراخوان، انقضا، یکپارچگی

```text
Before starting, check the list of available skills. Use every skill that fits this task.
At the end, say which skills you used, or that none fit.

Task: reports of the lot system and the product history report Del asked for: "a report by
product name that shows the whole history of a product, and every event of the product can be
followed by lot or batch number" (plan docs/lot-tracking/LOT-plan.md, section 10). Behind
LOT_TRACKING. Requires LOT-1..3 merged (LOT-4 helps for links). Branch: saas/lot-reports. Draft
PR. Follow every rule in CLAUDE.md and docs/ui-standard.md.

1. Migration 20261112140000_lot_reports.sql (check the prefix) with read RPCs that check
   lots_can('view') and hide money without the financial figures permission:
   - product_history(p_product, p_from, p_to, p_warehouse, p_lot, p_kinds, p_limit, p_offset):
     rows from stock_lot_movements joined to document headers (number, customer / supplier /
     partner name, line price), with running balance (total, and per warehouse when filtered),
     opening balance before p_from, totals in / out, closing; plus non-stock events of the
     product (created, edited, price changes from audit_logs while retained, count results)
     marked as such. Polywood in metres with pieces count.
   - lot_trace(p_lot_or_batch_no): backward chain and forward customers (with phone / email
     if the customer record has them), qty, invoices, remaining stock per warehouse.
   - lots_stock(p_warehouse, p_product, p_as_of): on hand by lot x warehouse with age in days
     and expiry; lots_expiry(p_days): expired or expiring with stock.
2. Reports screens under Hesabatlar (src/app/reports/...), each with filters, a data grid,
   totals, drill-down links to documents and lot cards, Excel and PDF export (the repo's export
   helper), print layout:
   - Məhsul tarixçəsi (product history): product lookup by name / code / barcode, date range
     (default this year), warehouse, lot (lookup by lot no or supplier batch no), event types.
     Also reachable from the products list row menu "History".
   - Lot trace / recall: one search box; result as origin -> warehouses -> customers; "export
     customer list" for a recall.
   - Stock by lot, and Expiry.
   - Lot integrity (admin only): lot_integrity_report() rows with a fix button
     (lot_integrity_fix with reason). Link it next to the existing StockIntegrityPage. Keep the
     RPC output stable: the future accounting guard agent (Del's item 10) will read it.
3. i18n az / en / ru; ui-standard lists and page frame; phone layout.
4. Tests: supabase/tests/lot_reports.sql (history running balance and opening balance across a
   sale, cancel, transfer and write-off; trace after a split receipt sold to two customers;
   permission without financial figures hides prices); node tests for report shaping and export
   columns. npm run lint, npm test, npm run build.

PR description: plain words, tests, ui-standard rule ids, manual step: run the migration on
production after LOT-1..3 SQL.
```
