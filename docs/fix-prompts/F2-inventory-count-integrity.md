# پرامپت F2: یکپارچگی محصولات در انبارگردانی، انبارگردانی با تاریخ قبل و ویرایش ادمین
> بخشی از «اصلاحات خارج از فازها» در کنار [`claude-code-prompts.md`](../claude-code-prompts.md). در فایل جدا نگه داشته شده تا با PRهای دیگری که همان فایل را تغییر می‌دهند تداخل نکند. روش اجرا مثل بقیه پرامپت‌هاست: یک جلسه تازه Claude Code، کپی متن داخل بلوک.


**درخواست Del (۲۰۲۶-۱۰-۲۸):** (۱) بعضی محصولات در لیست محصولات هستند ولی در لیست انبارگردانی نیستند؛ یکپارچگی محصولات در کل سیستم دقیق چک شود. (۲) انبارگردانی با تاریخ قبل فقط برای ادمین، با پیام هشدار. (۳) ادمین (فقط ادمین) بتواند همه انبارگردانی‌ها را در هر وضعیتی ویرایش کند.

**علت‌هایی که در کد پیدا شد (بررسی ۲۰۲۶-۱۰-۲۸):**

1. **انبارگردانی کل انبار فقط محصولاتی را می‌آورد که در ردیف همان انبار موجودی غیرصفر دارند** (`inventory_warehouse_product_ids`). لیست محصولات `products.stock` را نشان می‌دهد ولی انبارگردانی از `warehouse_stocks` می‌خواند. هر جا این دو با هم نخوانند، محصول در لیست هست و در انبارگردانی نیست.
2. **تریگر `upsert_warehouse_stock_from_product` موجودی کل را روی «آخرین ردیف انباری که دست خورده» می‌نویسد.** وقتی محصولی در دو انبار ردیف دارد، هر فروش یا خریدی که فقط `products.stock` را عوض کند کل موجودی را روی یکی از انبارها می‌ریزد. موجودی بین انبارها جابه‌جا می‌شود و انبار دیگر صفر می‌شود و آن محصول از انبارگردانی آن انبار حذف می‌شود.
3. **ردیف‌های قدیمی بدون انبار (`warehouse_id IS NULL`) فقط برای انبار پیش‌فرض حساب می‌شوند.** در انبارهای دیگر دیده نمی‌شوند.
4. **محصولات پلی‌وود از روی تکه‌ها (`polywood_pieces`) شمرده می‌شوند،** نه `products.stock`. اگر تکه‌ها با موجودی متری یکی نباشند (یا تکه‌ای نباشد)، محصول در انبارگردانی نیست یا عددش فرق دارد.
5. **ویوی `product_category_paths` زیرگروه را از جدول اشتباه می‌خواند:** `sub_category_id` به جدول `sub_categories` اشاره می‌کند ولی ویو آن را با `categories` جوین می‌کند. محصولی که زیرگروهش فقط با `sub_category_id` ثبت شده (مثلاً واردشده از ایمپورت پلی‌وود) در انبارگردانی «زیرگروه» نمی‌آید.
6. لیست کشویی دسته‌بندی‌ها در فرم انبارگردانی فقط دسته‌هایی را نشان می‌دهد که الان موجودی دارند.
7. **تاریخ انبارگردانی الان برای همه آزاد است** ولی موجودی دفتری همیشه موجودی امروز است، پس انبارگردانی با تاریخ قبل الان عملاً غلط حساب می‌شود.

**نتیجه اجرای اسکریپت روی پروداکشن (Del، ۲۰۲۶-۱۰-۲۹):** ۳۰۵ محصول ردیف موجودی بدون انبار دارند (۱۷۱ تا با موجودی غیرصفر و ۱۳۴ تا با موجودی صفر)، یک محصول پلی‌وود ناهمخوان است (`PW-469-PD`: موجودی محصول ۴ متر، تکه‌های موجود ۱۲ متر) و سه مورد خدمت/ترکیبی هستند که عمداً کنار گذاشته می‌شوند. هیچ مورد `total_mismatch`، `no_stock_row`، `subcategory_lost`، `no_category`، کد یا بارکد تکراری پیدا نشد. نتیجه‌گیری: علت ۱ (محصولِ با موجودی صفر در انبارگردانی کل انبار نمی‌آید) و علت ۳ (ردیف بدون انبار فقط در انبار پیش‌فرض دیده می‌شود) در داده‌ی واقعی تأیید شد؛ ۱۳۴ محصول با موجودی صفر دقیقاً همانی هستند که در لیست محصولات دیده می‌شوند و در انبارگردانی نیستند. علت‌های ۲ (تریگر) و ۵ (زیرگروه) در داده‌ی فعلی اثری نگذاشته‌اند، ولی کد آن‌ها همچنان باید اصلاح شود تا خراب نشوند. چون یک انبار پیش‌فرض وجود دارد (کد `null_row_no_default` نیامد)، انتقال ردیف‌های بدون انبار به آن امن است و همان چیزی است که انبارگردانی الان فرض می‌کند.

**اسکریپت بررسی (فقط خواندنی، روی پروداکشن بی‌خطر):** `supabase/scripts/product_integrity_check.sql` در همین PR. Del آن را در SQL Editor اجرا می‌کند تا معلوم شود کدام محصولات و به کدام علت از انبارگردانی جا مانده‌اند. نتیجه را قبل از اجرای پرامپت به Claude بدهید تا اگر علت دیگری بود به پرامپت اضافه شود.

**تصمیم‌ها (پیشنهاد داخل پرانتز، منتظر تأیید Del):**

1. انبارگردانی کل انبار همه محصولات قابل‌انبار را بیاورد، حتی با موجودی صفر؟ (بله. سطرهای شمرده‌نشده هیچ‌وقت اصلاح نمی‌شوند، پس ضرری ندارد. یک فیلتر «فقط دارای موجودی» در صفحه شمارش اضافه می‌شود.)
2. برای انبارگردانی با تاریخ قبل، موجودی دفتری «در پایان آن روز» از روی حرکات انبار حساب شود؟ (بله. موجودی امروز منهای حرکات بعد از آن روز. فروش‌ها و خریدهای بعد از آن تاریخ سر جایشان می‌مانند و سند حسابداری با همان تاریخ ثبت می‌شود.)
3. ویرایش انبارگردانی ثبت‌شده (posted) چطور باشد؟ (ادمین دکمه «ویرایش» می‌زند، سیستم اثر آن را کامل برمی‌گرداند (استورنو: حرکات انبار، لایه‌های FIFO، تکه‌های پلی‌وود، سند حسابداری)، سند به حالت «بازبینی» برمی‌گردد، ادمین اصلاح می‌کند و دوباره ثبت می‌کند. اگر کالای مازاد آن انبارگردانی بعداً فروخته شده باشد، برگرداندن رد می‌شود با پیام روشن.)
4. اصلاح داده‌های خراب فعلی (ردیف‌های بدون انبار، اختلاف جمع انبارها با کل؛ ۳۰۵ مورد بدون انبار الان وجود دارد) خودکار باشد؟ (نه. یک صفحه «یکپارچگی موجودی» فقط برای ادمین که اول پیش‌نمایش می‌دهد و ادمین برای هر مورد یا همه با هم «اصلاح» می‌زند.)

```text
Before starting, check the list of available skills. Use every skill that fits this task.
At the end, say which skills you used, or that none fit.

Task: (A) make every stockable product reachable by inventory counts and keep product stock consistent
across the system, (B) let admins only create backdated inventory counts with a warning, (C) let admins
only edit any inventory count in any status, including posted ones. Branch: saas/inventory-count-integrity.
Open a draft PR.

Read first: supabase/migrations/20260924140000_inventory_counts.sql (lifecycle, posting, ledger),
20260924160000_inventory_count_save_progress.sql, 20261017100000_inventory_count_add_product.sql,
20261017110000_inventory_count_start_all_category_products.sql,
20260924120000_initial_balance_unpost.sql (the storno pattern to copy for unposting),
20260918130000_fix_warehouse_stock_product_trigger.sql, 20260916150000_stock_transfers_and_multi_warehouse_stocks.sql,
src/modules/inventory/actions/inventoryCount.ts, src/modules/inventory/components/InventoryCountsPage.tsx,
src/modules/inventory/components/InventoryCountDetailPage.tsx, supabase/scripts/product_integrity_check.sql.

Causes found by review (verify each, fix each):
1. inventory_warehouse_product_ids only returns products with non-zero stock in that warehouse's
   warehouse_stocks row, while the product list shows products.stock.
2. trg_upsert_warehouse_stock_from_product copies products.stock (the total) onto the most recently
   touched warehouse_stocks row of the product. With rows in two warehouses, any code path that only
   changes products.stock moves the whole quantity onto one warehouse and zeroes the other.
3. warehouse_stocks rows with warehouse_id NULL only count for the default warehouse.
4. Polywood products are counted from polywood_pieces; products.stock can disagree with the pieces.
5. product_category_paths joins categories ON id = products.sub_category_id, but sub_category_id
   references sub_categories. Subcategories set only through sub_category_id are lost.
6. get_warehouse_active_categories only lists categories that have stock now.
7. count_date is free for every user, but expected_qty is always today's book quantity.

Part A: product and stock integrity (migration 1)
- Invariant to enforce: for non-polywood stockable products, products.stock = SUM(warehouse_stocks.current_stock)
  over its rows; for polywood products, products.stock = metres of available pieces and each warehouse row
  equals the metres of its available pieces. Find EVERY function, trigger and server action that writes
  products.stock or warehouse_stocks (grep migrations and src) and list them in the PR.
- Replace the "most recently touched row" logic: when products.stock changes and the writer did not already
  set the warehouse row, apply the DELTA (NEW.stock - OLD.stock) to the row of the document's warehouse,
  or the default warehouse when the writer has no warehouse. Warehouse-aware writers (count posting,
  transfers, initial balance, _inventory_count_set_stock) set a transaction-local flag
  (set_config('app.skip_stock_sync','on',true)) so the trigger does not touch rows twice. Never write the
  total onto a single row again.
- Fix product_category_paths to read subcategory names from sub_categories (keep the legacy text fallback
  and the linked child-category case).
- Whole-warehouse count start: every stockable product (not service, not composite) gets a line, with or
  without stock. Category count: unchanged scope, but through the fixed view. Category dropdown: every
  category/subcategory that has stockable products, with the count of products, not only stocked ones.
- Count detail page: add a filter "only lines with book stock" and "only uncounted" so long lists stay usable.
  "Mark uncounted as zero" stays as is (a zero-book line marked zero changes nothing).
- Admin-only page Settings > Stock integrity (no flag needed, admin only): runs the same checks as
  supabase/scripts/product_integrity_check.sql through a SECURITY DEFINER RPC that checks
  public.user_is_admin(), shows them grouped by issue with product code/name, and offers "Fix" per row
  and "Fix all of this kind" for the safe kinds only:
    null_warehouse_row  -> move the row onto the default warehouse (merge if a row exists)
    total_mismatch / stock_only_in_list -> set products.stock to the sum of the warehouse rows (the warehouse
                           rows are what was counted); show before/after; write a stock_movements row with
                           reference_type 'stock_integrity_fix' only when a warehouse row changes
    subcategory_lost    -> copy sub_categories.name into products.subcategory
    (polywood_mismatch is NOT auto-fixed: the production check shows PW-469-PD with products.stock 4 m but
     12 m of available pieces, and only the shop floor knows which is right. List it for review; the fix is
     an inventory count, which the count RPCs already handle by pieces.)
  Kinds that need a human (polywood_mismatch, duplicate_code, duplicate_barcode, no_category, polywood_no_pieces,
  category_text_differs) are listed with a link to the product, never auto-fixed. No ledger entries for
  these fixes (they correct cached totals, not value); say so on the page. Every fix goes to audit_logs.

Part B: backdated inventory counts, admin only (migration 2)
- Rule in the database, not only the UI: a BEFORE INSERT OR UPDATE OF count_date trigger on inventory_counts
  raises when count_date > today (Asia/Baku), and when count_date < today and NOT public.user_is_admin().
  Service role calls (auth.uid() IS NULL) are allowed. Changing count_date is allowed only in draft
  (admins: also in in_progress/review, which recomputes expected_qty, see below).
- Add inventory_counts.book_as_of TIMESTAMPTZ: NULL for a normal count; for a backdated one the end of
  count_date in Asia/Baku.
- New function inventory_count_book_qty_at(product, warehouse, as_of) = current book quantity minus the
  net stock_movements of that product and warehouse with created_at > as_of (in adds, out subtracts; rows
  with warehouse_id NULL belong to the default warehouse, matching inventory_count_book_qty).
  inventory_count_start, inventory_count_add_product, inventory_count_scan and inventory_count_resync_book use
  it when book_as_of is set. Posting is unchanged: it applies (actual - expected) to today's stock, so sales
  after the count date stay booked, and the journal entry is already dated count_date; the closed-period
  check already refuses closed months.
- Polywood lines in a backdated count: pieces cannot be rebuilt for a past date. Expected metres come from
  the as-of function; the counter enters metres (not pieces) for these lines; on posting, a surplus creates
  one 'cut' piece of the surplus length, a shortage consumes available pieces shortest first (split the last
  one if needed). Explain this in the warning.
- UI (InventoryCountsPage create form): date input max = today. Non-admins: the date is today and read-only.
  Admins picking a past date see an amber warning under the field, and a confirm dialog on create:
  "This count is dated <date>. Book quantities are calculated as of the end of that day from stock movements;
  movements after that date stay booked; the accounting entry is dated <date>. Stock movements recorded
  before the movement log existed are not included, so check the expected quantities before posting."
  The list and detail page show a "Backdated" badge with the date.

Part C: admins edit any count in any status (same migration 2)
- draft / in_progress: unchanged (already editable by users with can_writeoff_inventory).
- review: admins can edit line quantities and the header (date, responsible, notes) without reopening;
  save_count_progress accepts 'review' when public.user_is_admin(); totals and drift refresh after save.
- posted: new RPC inventory_count_unpost(p_count_id UUID, p_reason TEXT), admin only, reason required.
  It reverses every effect of inventory_count_post in one transaction, copying the storno pattern of
  unpost_inventory_initial_balance:
    stock_movements -> offsetting rows (reference_type 'inventory_adjustment_reversal'), originals kept
    warehouse_stocks / products.stock -> restored by -applied_qty through _inventory_count_set_stock
    surplus inventory_batches -> removed only while unconsumed; shortage FIFO consumptions
      (inventory_batch_consumptions with source_type/source_id of this count) -> returned to their batches
    polywood -> pieces created by this count (source_document_id) removed only while still available;
      pieces it consumed restored to available. Add polywood_pieces.consumed_by_document_id, set it in
      posting from now on, and backfill old counts by matching notes 'İnventarizasiya çatışmazlığı — <doc no>'.
    journal -> reverse_document_journals(count id, reason)
  Then status -> 'review', applied_qty/applied_value cleared, unposted_at/unposted_by/unpost_reason and
  post_revision (+1) stored. Re-posting uses idempotency_key 'inventory_count:<id>:<revision>' so the new
  entry is not blocked by the old one. Refuse with a clear message listing the products when a surplus was
  already sold or cut, or when count_date is in a closed period.
- Deleting: admins may delete a count in any status except posted (unpost first). Non-admins unchanged.
- UI: on a posted count admins see "Edit (unpost)" with a reason dialog and a red warning that stock and the
  accounting entry are reversed and the count must be posted again. Non-admins never see these buttons.
  Every admin edit, unpost and re-post is logged to audit_logs and the count's chatter if available.

General
- One migration per DB change, two files with unique prefixes that are not on main or in any open PR
  (check ls supabase/migrations and the open PRs; suggested 20261028181000_product_stock_integrity.sql and
  20261028182000_inventory_count_backdate_admin_edit.sql). Module-table changes inside the existing
  to_regclass guard pattern.
- No feature flag: Part A is a bug fix; Parts B and C are admin-only and remove a hole (non-admins can no
  longer backdate), so staff see no new UI except the date field becoming read-only.
- Every UI string through src/i18n (az, en, ru).
- Tests: supabase/tests/inventory_count_integrity.sql (start lists zero-stock products; subcategory via
  sub_category_id; trigger applies deltas to the right warehouse with two warehouses; non-admin backdate is
  refused; as-of quantity with movements after the date; unpost restores stock, batches, pieces and journal
  and re-post works; unpost refused after the surplus is sold). Vitest for the date rules and any TS helper.
- Run npm run lint, npm test, npm run build. Run both migrations and the SQL tests on the dev project
  (ligzyakoovmymbkwzkia) or a local database, never on production.

PR description: what changed in plain words, the list of every writer of products.stock / warehouse_stocks
and what changed in each, how it was tested, and Del's manual steps in order: run
supabase/scripts/product_integrity_check.sql and save the result, run migration 1, run migration 2, open
Settings > Stock integrity as admin, review and fix, then start a new whole-warehouse count and confirm the
missing products are listed.

Done when: every stockable product of the product list appears in a whole-warehouse count of its warehouse;
the integrity page shows no auto-fixable issue after "Fix all"; a non-admin cannot save a past count date
(UI and direct RPC); an admin can create a backdated count after the warning and its expected quantities
match the stock at the end of that day; an admin can unpost, edit and re-post a posted count with stock and
ledger back in balance.
```
