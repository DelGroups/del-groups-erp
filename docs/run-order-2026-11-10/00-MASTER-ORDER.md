# ترتیب اجرای همه پرامپت‌ها (۲۲ پرامپت، ۲۰۲۶-۱۱-۱۰)

هر ردیف یک فایل جدا در همین پوشه است (`NN-نام.md`). متن فایل را کامل در Claude Code (VS Code) بدهید.
**قانون:** هر پرامپت یک شاخه و یک PR دارد. PR را merge کنید و (اگر SQL دارد) SQL را اجرا کنید، بعد پرامپت بعدی. پرامپت‌ها را پشت‌سرهم و نه موازی اجرا کنید، چون چند تا از آن‌ها همان توابع فروش، خرید و انبار را بازنویسی می‌کنند و هر کدام باید از آخرین main شروع کند.
SQL را فقط خود شما روی production اجرا می‌کنید (Claude Code فقط روی دیتابیس تست امتحان می‌کند).

## مرحله ۱: فرم فاکتورها (سریع، بدون خطر برای حسابداری)

| # | فایل | شاخه | SQL | بعد از merge |
|---|---|---|---|---|
| 1 | `01-INV-1.md` دکمه محصول جدید در فرم فروش و خرید | `saas/invoice-new-product` | ندارد | فلگ `INVOICE_TOOLS=true` |
| 2 | `02-INV-2.md` خروجی Excel و PDF فاکتور | `saas/invoice-export` | ندارد | همان فلگ |
| 3 | `03-INV-3.md` فیلتر فروشنده و ثبت‌کننده در لیست فاکتورها | `saas/invoice-list-person-filters` | ندارد | همان فلگ |
| 4 | `04-INV-4.md` مسئول انبارگردانی چندنفره | `saas/inventory-count-team` | `20261110100000_inventory_count_responsibles` | اجرای SQL، فلگ `COUNT_TEAM=true` |

## مرحله ۲: حساب هر طرف تجاری و گزارش بدهکار و طلبکار

| # | فایل | شاخه | SQL | بعد از merge |
|---|---|---|---|---|
| 5 | `05-LED-1.md` دفتر واحد طرف تجاری (فقط دیتابیس) | `saas/led-1-partner-ledger` | ۱ فایل | SQL را اجرا کنید، کوئری کنترل را اجرا و نتیجه را بفرستید |
| 6 | `06-LED-2.md` اصلاح `partner_id` در دفتر کل | `saas/led-2-gl-partner-fix` | ۱ مایگریشن + ۲ اسکریپت | مایگریشن؛ backfill فقط بعد از دیدن گزارش |
| 7 | `07-LED-3.md` صفحه صورت‌حساب هر طرف (مورد ۶) | `saas/led-3-partner-statement` | ندارد | `PARTNER_LEDGERS=true` (اول فقط ادمین) |
| 8 | `08-LED-4.md` بدهکاران، طلبکاران، گردش | `saas/led-4-debtors-creditors` | حداکثر ۱ فایل | SQL |
| 9 | `09-LED-5.md` گزارش سنی بدهی (Aging) | `saas/led-5-aging` | حداکثر ۱ فایل | SQL |

LED-1 باید قبل از ۷ تا ۹ merge شود. پیشوند مایگریشن‌های LED را خود Claude Code آزاد انتخاب می‌کند (با `ls supabase/migrations`).

## مرحله ۳: تغییر تاریخ سند (فقط ادمین)

قبل از لوت آمده، چون موتور تغییر تاریخ باید هنگام ساخت لوت‌ها از قبل وجود داشته باشد (LOT-1 به آن وصل می‌شود).

| # | فایل | شاخه | SQL | بعد از merge |
|---|---|---|---|---|
| 10 | `10-DATE-1.md` موتور + فاکتور فروش و خرید | `saas/doc-date-change-core` | `20261110150000_document_date_change_core` | SQL، فلگ `DOC_DATE_CHANGE=true` |
| 11 | `11-DATE-2.md` اسناد نقد و بانک | `saas/doc-date-change-cash` | `20261110151000_document_date_change_cash` | SQL |
| 12 | `12-DATE-3.md` اسناد انبار و واردات | `saas/doc-date-change-inventory` | `20261110152000_document_date_change_inventory` | SQL |

(پرامپت DATE یک تصمیم باز دارد: تغییر تاریخ در همان ردیف‌ها با لاگ، که پیشنهاد است، یا برگشت و ثبت دوباره. اگر نظر ندارید همان پیشنهاد اجرا می‌شود.)

## مرحله ۴: لوت و بچ و تاریخچه محصول (موارد ۴ و ۵)

| # | فایل | شاخه | SQL | بعد از merge |
|---|---|---|---|---|
| 13 | `13-LOT-1.md` هسته دیتابیس + backfill | `saas/lot-core` | `20261112100000_lot_core` | **SQL را هنوز اجرا نکنید** |
| 14 | `14-LOT-2.md` ورود کالا با لوت + برچسب | `saas/lot-inbound` | `20261112110000_lot_inbound` | **هنوز اجرا نکنید** |
| 15 | `15-LOT-3.md` خروج، انتقال اتمی، لغو | `saas/lot-outbound` | `20261112120000_lot_outbound` | حالا سه SQL را با هم و به ترتیب اجرا کنید، بعد `SELECT * FROM lot_integrity_report();` باید خالی باشد |
| 16 | `16-LOT-4.md` صفحه‌های لوت و کارت لوت | `saas/lot-ui` | فقط اگر لازم شد | `LOT_TRACKING=true` و `LOT_TRACKING_AUDIENCE=admins` |
| 17 | `17-LOT-5.md` گزارش تاریخچه محصول، فراخوان، انقضا | `saas/lot-reports` | `20261112140000_lot_reports` | SQL |

## مرحله ۵: نگهبان حسابداری (آخر، چون همه چیز را کنترل می‌کند)

| # | فایل | شاخه | SQL | بعد از merge |
|---|---|---|---|---|
| 18 | `18-GUARD-1.md` جدول‌ها و موتور قوانین | `saas/accounting-guard-core` | `20261120100000_accounting_guard_core` | SQL، `ACCOUNTING_GUARD=true` |
| 19 | `19-GUARD-2.md` اسم تکراری محصول و چک‌های انبار | `saas/accounting-guard-products` | `20261120110000_accounting_guard_products` | SQL |
| 20 | `20-GUARD-3.md` بخش نگهبان، دکمه سند مشکوک، اعلان | `saas/accounting-guard-ui` | ندارد یا `20261120120000_...` | — |
| 21 | `21-GUARD-4.md` نظارت دائمی با pg_cron | `saas/accounting-guard-schedule` | `20261120130000_accounting_guard_cron` | اول `pg_cron` را در Supabase فعال کنید، بعد SQL |
| 22 | `22-GUARD-5.md` ایجنت حسابدار Claude | `saas/accounting-guard-agent` | `20261120140000_accounting_guard_reports` | `ACCOUNTING_GUARD_AI=true` + secret سرور و GitHub |

یادآوری برای GUARD-1: بعد از اجرای LOT، قانون «یکپارچگی لوت» (خروجی `lot_integrity_report()`) هم باید یکی از چک‌ها باشد. در پرامپت GUARD-1 به Claude Code بگویید.

## چرا این ترتیب

- فرم‌های INV کوچک و بی‌خطرند و فوراً به کار می‌آیند.
- LED قبل از بقیه است چون دفتر واحد طرف تجاری و اصلاح `partner_id` پایه صحیح بودن مانده‌هاست (GUARD هم روی آن تکیه دارد).
- DATE قبل از LOT است تا لوت‌ها از اول با موتور تغییر تاریخ هماهنگ باشند.
- GUARD آخر است چون باید همه سیستم‌ها (لیدجر، تاریخ، لوت) را کنترل کند.

## هشدار

`.env.local` روی کامپیوتر شما به دیتابیس **production** وصل است. هر پرامپت می‌گوید SQL را فقط روی Supabase محلی یا پروژه تست `del-groups-erp-dev` امتحان کند. قبل از اجرا یک بار این را به Claude Code هم یادآوری کنید.
