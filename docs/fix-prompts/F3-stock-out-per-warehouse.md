# پرامپت F3: هر خروجی از انبار، موجودی همان انبار را کم کند
> بخشی از «اصلاحات خارج از فازها» در کنار [`claude-code-prompts.md`](../claude-code-prompts.md) و [`F2`](F2-inventory-count-integrity.md). در فایل جدا نگه داشته شده تا با PRهای دیگری که همان فایل را تغییر می‌دهند تداخل نکند. روش اجرا مثل بقیه پرامپت‌هاست: یک جلسه تازه Claude Code، کپی متن داخل بلوک.

**ترتیب اجرا:** بعد از F1 (فاکتور و پرداخت با تاریخ قبل) و 24c (ستون‌های لیست). F2 (PR #70) روی main ادغام شده و این پرامپت روی آن ساخته می‌شود.

**ریسک تداخل با F1:** F1 همان تابع‌های فروش را بازنویسی می‌کند (`save_sales_invoice_draft`، `post_sales_invoice_draft`، `process_sales_invoice_event`، `handle_sales_posted_inventory`) و صفحه‌های فروش را عوض می‌کند. F3 باید روی نسخه‌ای از این تابع‌ها ساخته شود که F1 روی main گذاشته، وگرنه تاریخ قبل F1 پاک می‌شود. برای همین پرامپت اول چک می‌کند F1 ادغام شده باشد و اگر نشده باشد متوقف می‌شود.

**درخواست Del (۲۰۲۶-۱۰-۲۹):** «اگر محصولی خراب شده و از انبار خارج می‌شود باید از موجودی کم شود. این یک قانون مشخص است: هر خروجی از انبار باید از موجودی همان انبار کم شود.» (جواب تصمیم باز F2، گزینه الف.)

**وضع فعلی در کد (بررسی ۲۰۲۶-۱۰-۲۹ روی main بعد از ادغام #70):**

F2 تریگر `upsert_warehouse_stock_from_product` را درست کرد: وقتی فقط `products.stock` عوض می‌شود، تغییر به انباری می‌رود که نویسنده با `stock_sync_use_warehouse(id)` نام برده، وگرنه به انبار پیش‌فرض. ولی نویسنده‌های زیر انبار را می‌دانند و نام نمی‌برند، پس خروجی‌شان همیشه از **انبار پیش‌فرض** کم می‌شود و انبار واقعی دست نمی‌خورد. بررسی موجودی هم روی کل محصول است، نه روی انبار.

| بخش | کجا | مشکل |
|---|---|---|
| ضایعات (کالای خراب) ثبت | `src/modules/inventory/lib/writeoff.ts` → `submitDamagedGoodsWriteoff` | از مرورگر، سطر به سطر `products.stock` را کم می‌کند (`decrementProductStock`). انبار سند (`warehouse_id`) فقط ذخیره می‌شود. اتمیک نیست، حرکت انبار (`stock_movements`) ثبت نمی‌شود. |
| ضایعات ویرایش | همان فایل → `updateInventoryWriteoff` | فقط اختلاف مقدار روی کل محصول اعمال می‌شود. اگر انبار سند عوض شود، هیچ چیز جابه‌جا نمی‌شود. |
| فرم ضایعات | `DamagedGoodsForm.tsx`، `fetchProductsByWarehouse` | «موجودی» ستون فرم `products.stock` (کل) است، نه موجودی همان انبار. فیلتر محصول بر اساس `products.warehouse_id` است، نه `warehouse_stocks`. |
| فروش ثبت | `build_and_validate_sale_stock_demand` و `apply_sale_stock_decrement` (از `handle_sales_posted_inventory`، `create_sale_atomic`، `process_sales_invoice_event`) | تقاضا فقط بر اساس محصول جمع می‌شود و `products.stock` کم می‌شود، با این‌که هر سطر `sale_items.warehouse_id` دارد. کیت‌ها (BOM) هم همین‌طور. |
| فروش لغو | `cancel_sales_invoice_atomic`، `void_sale_atomic`، `void_sale_invoice`، `restore_sale_stock`، و از مرورگر `src/lib/finance/customerAr.ts` | موجودی به کل محصول (یعنی انبار پیش‌فرض) برمی‌گردد. `customerAr.ts` از مرورگر و غیراتمیک `products.stock` را بالا می‌برد. در لغو پلی‌وود، `products.stock` برابر متر تکه‌های **یک** انبار گذاشته می‌شود که وقتی تکه‌ها در چند انبار باشند کل را خراب می‌کند. |
| تولید، خروج مواد | `process_production_material_issue_event` | `production_materials.warehouse_id` را فقط در `stock_movements` می‌نویسد؛ بررسی و کسر روی کل محصول است. |
| تولید، برگشت مواد | `src/modules/production/actions/production.ts` (`removeProductionMaterialAction` و حذف سفارش) | `incrementProductStock` روی کل محصول. |
| تولید، محصول آماده | `process_production_ready_event` | محصول آماده به کل اضافه می‌شود، نه به انبار مبلمان (`furniture_warehouse_id`). |
| تولید، تحویل | `process_production_delivery_event`، `complete_custom_production_delivery_atomic` | کسر از کل محصول، نه از انبار مبلمان. |

پلی‌وود از قبل درست است: تکه‌ها انبار دارند و F2 ردیف‌های پلی‌وود را از روی تکه‌ها می‌سازد. فقط مورد لغو بالا باید درست شود.

**تصمیم‌ها (پیشنهاد داخل پرانتز، منتظر تأیید Del):**

1. اگر کل محصول کافی است ولی **همان انبار** کافی نیست، چه شود؟ (رد شود، با پیام روشن: نام محصول، نام انبار، موجودی همان انبار و مقدار خواسته‌شده. این همان قانون Del است. قبل از اجرا، Del صفحه «یکپارچگی موجودی» F2 را اجرا و «اصلاح همه» را بزند تا ۳۰۵ ردیف بدون انبار سر جایشان بروند، وگرنه فروش از انبارهای غیرپیش‌فرض ممکن است رد شود.)
2. خرید و ورودی‌ها (فاکتور خرید، برگشت مشتری، ورود محصول آماده) هم به همان انبار سند بروند؟ (بله. اگر فروش از انبار ب کم کند ولی خرید همیشه به انبار پیش‌فرض برود، انبار ب هیچ‌وقت موجودی نمی‌گیرد و فروش‌ها رد می‌شوند. فاکتور خرید `purchases.warehouse_id` دارد.)
3. سطر فروش بدون انبار (`sale_items.warehouse_id` خالی) از کجا کم شود؟ (از انبار پیش‌فرض، مثل امروز. جدول `sales` ستون انبار ندارد، فقط نام انبار.)
4. فلگ؟ (بدون فلگ، مثل F2: این رفع باگ است و صفحه جدیدی برای کارمندان ندارد. فقط پیام «موجودی کافی نیست» حالا نام انبار را می‌آورد. Del اگر بخواهد، می‌شود پشت فلگ `STOCK_PER_WAREHOUSE` گذاشت؛ ولی بخش SQL را نمی‌شود با فلگ خاموش کرد.)

```text
Before starting, check the list of available skills. Use every skill that fits this task.
At the end, say which skills you used, or that none fit.

Task: every stock movement that knows its warehouse must change the stock of THAT warehouse
(warehouse_stocks row) and the product total together, in one database transaction, and must be
refused when that warehouse does not have enough. Covers damaged-goods write-offs, sales invoices
(post, cancel, void), production orders (material issue/return, finished goods in, delivery) and,
per decision 2, purchases and customer returns. Branch: saas/stock-out-per-warehouse. Open a draft PR.

Precondition: fix prompt F1 (backdated invoices/payments, docs/claude-code-prompts.md "F1") must be
merged to main. If it is not, stop and say so. F1 redefines save_sales_invoice_draft,
post_sales_invoice_draft, process_sales_invoice_event and handle_sales_posted_inventory: start every
CREATE OR REPLACE from the newest definition on main (latest migration that defines it, else
supabase/modules/<module>/install.sql, else supabase/baseline/04_functions.sql) and keep all of F1's
behaviour (document dates, period checks).

Read first:
- docs/fix-prompts/F2-inventory-count-integrity.md and
  supabase/migrations/20261028181000_product_stock_integrity.sql (the invariant, _stock_row_for,
  adjust_warehouse_stock, stock_sync_skip, stock_sync_use_warehouse, the products.stock trigger)
- docs/fix-prompts/F3-stock-out-per-warehouse.md (this file: the table of writers and the decisions)
- src/lib/inventory/stockAdjustment.ts, src/lib/inventory/warehouseProductStock.ts
- src/modules/inventory/lib/writeoff.ts, src/modules/inventory/components/DamagedGoodsForm.tsx
- supabase/baseline/04_functions.sql: build_and_validate_sale_stock_demand, apply_sale_stock_decrement,
  merge_stock_demand, handle_sales_posted_inventory
- supabase/modules/sales/install.sql: create_sale_atomic, process_sales_invoice_event,
  cancel_sales_invoice_atomic, void_sale_atomic, void_sale_invoice, restore_sale_stock
- supabase/modules/production/install.sql: process_production_material_issue_event,
  process_production_ready_event, process_production_delivery_event,
  complete_custom_production_delivery_atomic; src/modules/production/actions/production.ts
- src/lib/finance/customerAr.ts (client-side sale void restoring stock)
- supabase/modules/purchases/install.sql (post_purchase_invoice_draft and its cancel/void paths)

Part A: one core function (migration 20261029100000_stock_per_warehouse.sql)
- public.stock_move(p_product_id uuid, p_warehouse_id uuid, p_delta numeric, p_strict boolean
  default true) returns numeric (the new warehouse quantity). SECURITY DEFINER, search_path public.
  Locks the product row, finds the row with _stock_row_for (NULL warehouse = default warehouse),
  refuses when p_strict and the row would go below zero with ERRCODE 22023 and an Azerbaijani
  message naming product, warehouse, available and required (use the same format() style as
  build_and_validate_sale_stock_demand; do NOT use RAISE EXCEPTION 'x' USING MESSAGE = ..., that
  gives "RAISE option already specified"), updates the row and products.stock by the same delta
  inside stock_sync_skip(true)/(false). Polywood products: raise, they move through pieces.
  Services and composite parents: no-op. Not executable by anon/authenticated; only other
  SECURITY DEFINER functions and service_role call it.
- Re-point adjust_warehouse_stock to stock_move(..., p_strict => false) so transfers, consignment
  and initial balances keep their clamp-at-zero behaviour.
- Warehouse fallback everywhere: the line warehouse, then the document warehouse, then
  stock_default_warehouse().

Part B: damaged-goods write-offs
- New RPCs in the same migration (inside the to_regclass guard for inventory_writeoffs):
  post_inventory_writeoff(p_payload jsonb) and update_inventory_writeoff(p_id uuid, p_payload jsonb).
  SECURITY DEFINER, require_permission('can_writeoff_inventory'), warehouse required, all lines in one
  transaction: insert/update the document, stock_move(product, warehouse, -qty) per line, one
  stock_movements row per line (movement_type 'out', reference_type 'writeoff', source_line_id when the
  line has one). Update: first give the old lines back to the OLD warehouse, then take the new lines
  from the NEW warehouse (so changing the warehouse moves the stock), replace the movements.
  Keep validation messages of the current TS code (at least one product, issue description per line).
- writeoff.ts calls the RPCs; delete the client-side decrement/rollback code paths that become unused
  (decrementProductStock and applyWriteoffStockDeltas only if nothing else uses them).
- DamagedGoodsForm: "available" column and the product list come from warehouse_stocks of the chosen
  warehouse (realStock helper in the inventory module if one exists, else a small query); changing the
  warehouse refreshes them. Polywood products are not offered here (they have their own flow).
- Keep the warehouse slip (createWarehouseSlip type 'waste') as today.

Part C: sales
- build_and_validate_sale_stock_demand returns demand keyed by "<product_id>:<warehouse_id>" (kits
  exploded through merge_stock_demand with the components taken from the SAME warehouse as the kit
  line) and validates each key against that warehouse row, not products.stock.
- apply_sale_stock_decrement applies each key with stock_move(-qty). Update every caller to the new
  key format: handle_sales_posted_inventory, create_sale_atomic, process_sales_invoice_event and any
  other caller you find (grep the migrations and module install files).
- Cancel / void (cancel_sales_invoice_atomic, void_sale_atomic, void_sale_invoice, restore_sale_stock):
  give each line back to its own warehouse with stock_move(+qty, strict false). Polywood rollback:
  after rollback_mixed_dimensional_sale, recompute the product total from ALL its available pieces (or
  let the F2 trigger do it), never from one warehouse's pieces.
- src/lib/finance/customerAr.ts: remove the client-side products.stock increment; the void must go
  through the atomic RPC (check which RPC the screen should call; if none fits, call
  cancel_sales_invoice_atomic).
- Stock messages shown to the user name the warehouse.

Part D: production
- process_production_material_issue_event: check and take each material from its
  production_materials.warehouse_id (fallback raw_material_warehouse_id, then order warehouse_id,
  then default) with stock_move. Keep the stock_movements rows and reservations logic.
- Material return (removeProductionMaterialAction and deleting an order in production.ts): give the
  quantity back to the material's warehouse through a SECURITY DEFINER RPC or adjustProductStockAtWarehouse
  (service role), not incrementProductStock.
- process_production_ready_event: finished goods go into furniture_warehouse_id, then warehouse_id,
  then default; add a stock_movements 'in' row if there is none today.
- process_production_delivery_event and complete_custom_production_delivery_atomic: take finished
  goods from the same warehouse (in and out on the same warehouse for make-to-order).

Part E: incoming (decision 2)
- post_purchase_invoice_draft (and its cancel/void/edit paths) and customer returns: add to / take back
  from the document warehouse with stock_move (strict false for adding, strict true when reversing a
  purchase whose goods are already gone, with a clear message).
- List in the PR any other writer of products.stock that still has no warehouse (e.g.
  src/modules/production/lib/inventory.ts incrementStandardStock, src/modules/polywood/actions/polywood.ts)
  and leave it unless it is a reversal of one of the flows above.

General
- One migration file, unique prefix not on main or in any open PR: suggested
  20261029100000_stock_per_warehouse.sql (check ls supabase/migrations and open PRs first).
  Module-table/function changes inside the existing to_regclass guard pattern. Safe to re-run.
- No feature flag (bug fix, like F2). No new UI strings except stock messages; every UI string
  through src/i18n (az, en, ru).
- Tests: supabase/tests/stock_per_warehouse.sql (in CI like inventory_count_integrity.sql) with two
  warehouses A (default) and B: write-off from B lowers B only and total; write-off over B's stock is
  refused even when A has enough; editing a write-off from B to A moves the stock back to B and out
  of A; sale line from B lowers B; kit sale from B lowers its components in B; cancel returns to B;
  production material issue from B lowers B; finished goods land in the furniture warehouse;
  delivery takes them from there; purchase into B raises B; after every step
  products.stock = SUM(warehouse_stocks.current_stock). Vitest for any TS helper you add or change.
- Run npm run lint, npm test, npm run build. Run the migration and the SQL tests on the dev project
  (ligzyakoovmymbkwzkia) or a local database, never on production.

PR description: what changed in plain words; the table of every stock writer touched and what it does
now; writers left unchanged and why; how it was tested; Del's manual steps in order: (1) on production
open Settings > Stock integrity as admin and "Fix all" (F2), (2) run
supabase/scripts/product_integrity_check.sql and confirm no null_warehouse_row / total_mismatch,
(3) run migration 20261029100000_stock_per_warehouse.sql in the SQL Editor, (4) as a normal user
write off one item from a non-default warehouse and check that warehouse's stock went down by that
amount and the default warehouse did not change.

Done when: a write-off, a sale, a production material issue and a production delivery each lower
exactly the stock of their own warehouse; their cancel/edit puts it back into the same warehouse;
an exit larger than that warehouse's stock is refused with a message naming the warehouse; and the
integrity page shows no total mismatch after these operations.
```
