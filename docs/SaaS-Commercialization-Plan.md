# برنامه مهندسی تجاری‌سازی Del Groups ERP (نسخه SaaS)

**تاریخ:** 2026-10-11
**وضعیت:** پیش‌نویس برای تصمیم Del. در این مرحله هیچ کدی تغییر نمی‌کند.
**مرتبط:** `docs/Upgrade-Plan-Studio-and-AI.md` (Studio و دستیار AI که الان روی main است).

---

## ۱. خلاصه تصمیم‌ها

| موضوع | پیشنهاد |
|---|---|
| جداسازی دیتای مشتری‌ها | **هر شرکت یک دیتابیس جدا** (یک پروژه Supabase مستقل برای هر اجاره‌کننده) + یک **دیتابیس مرکزی کنترل‌پنل** |
| آدرس هر شرکت | ساب‌دامین: `acme.<دامنه-محصول>` و امکان دامنه اختصاصی |
| کد برنامه | یک کد و یک دیپلوی برای همه شرکت‌ها؛ برنامه از روی دامنه می‌فهمد به کدام دیتابیس وصل شود |
| معماری ماژولار | هسته (Core) + ماژول‌های قابل نصب با فایل manifest، شبیه Odoo |
| قیمت‌گذاری | پلن ماهانه/سالانه = هزینه پایه + (قیمت هر ماژول × تعداد یوزر) |
| شرکت فعلی Del Groups | **مستأجر شماره ۱**؛ دیتابیس فعلی همان‌جا می‌ماند و منتقل نمی‌شود |
| UI جدید | پوسته جدید شبیه Odoo (App launcher، List/Kanban/Form/Pivot/Graph) با موشن و اینفوگراف، طرح‌ها از vibeprompts.dev؛ ماژول به ماژول جایگزین می‌شود |
| ماژول‌های جدید | Activities/Chatter، تقویم، CRM جدید، To-do، Documents و بقیه اپ‌های Odoo (بخش ۵.۴) |
| اجرا | پرامپت آماده Claude Code برای هر کار در `docs/claude-code-prompts.md` |

---

## ۲. وضعیت فعلی کد و دیتابیس (چیزی که بررسی شد)

- **کد:** Next.js 16 (App Router، `src/proxy.ts` به‌جای middleware)، React 19، Tailwind 4، TanStack Query، Zustand، Recharts، Radix UI. حدود ۶۰۷ فایل و ۱۰۸ هزار خط در `src/`.
- **دیتابیس زنده (Supabase `del-groups-erp`):** ۸۵ جدول، ۴ view، ۲۰۴ تابع، ۴۷ تریگر، **۱۹۱ RLS policy**، ۵ باکت Storage، ۸ یوزر، حجم ۲۳ مگابایت.
- **هیچ ستونی برای شرکت/مستأجر وجود ندارد** (`company_id` / `tenant_id` = صفر). سیستم کاملاً تک‌شرکتی طراحی شده است.
- **دسترسی‌ها:** RBAC دقیق با توابع `has_permission`, `user_is_admin`, `user_has_warehouse_access` و … که داخل RLS و ۲۲۹ تابع `SECURITY DEFINER` استفاده می‌شوند.
- **تنظیمات شرکت:** در `system_settings` (یک ردیفی) و شمارنده اسناد در `document_number_counters`؛ در ۴۱ فایل اسم یا مشخصات Del Groups به‌صورت ثابت آمده است.
- **مایگریشن‌ها:** ۱۱۷ فایل در `supabase/migrations` به‌علاوه ۳۵ فایل SQL قدیمی در `types/` که باید دستی و به ترتیب اجرا شوند. **امروز نمی‌شود با یک دستور یک دیتابیس خالی و کامل برای شرکت جدید ساخت.** این اولین کار فنی است.
- **کانفیگ:** آدرس Supabase موقع build داخل کد قرار می‌گیرد (`NEXT_PUBLIC_SUPABASE_URL`)، ولی مسیر `/api/public-config` از قبل هست و می‌شود آن را به کانفیگ زمان اجرا (runtime) برای هر مستأجر تبدیل کرد.
- **دیپلوی:** هر push به main از طریق GitHub Actions روی سرور Hetzner (Docker + Caddy) می‌رود.
- **ماژول‌های موجود:** فروش، خرید، انبار و انبارها، برش ورق (Polywood)، تولید، حسابداری دوطرفه و گزارش‌های مالی، هزینه‌ها، منابع انسانی و حقوق (مالیات آذربایجان)، CRM، قراردادها، کنسیگنیشن، کمیسیون، مالیات/ƏDV، گزارش‌ها، بارکد، Studio (فیلد سفارشی)، دستیار AI.

---

## ۳. معماری چندمستأجری (Multi-tenant)

### ۳.۱ سه گزینه و مقایسه

| معیار | A) دیتابیس مشترک + `tenant_id` + RLS | B) یک schema برای هر شرکت | C) یک دیتابیس (پروژه Supabase) برای هر شرکت |
|---|---|---|---|
| جداسازی دیتا | منطقی؛ یک باگ در یک policy یا یک تابع SECURITY DEFINER = نشت دیتای شرکت دیگر | متوسط | **کامل** (فیزیکی جدا) |
| تغییر در کد فعلی | **خیلی زیاد**: ستون جدید روی ۸۵ جدول، بازنویسی ۱۹۱ policy و بررسی ۲۰۴ تابع، یکتاسازی‌ها (شماره فاکتور، SKU، بارکد) باید per-tenant شوند | زیاد: Supabase Auth و Storage مشترک می‌مانند، PostgREST باید هر schema را جدا expose کند، توابع به `public.` اشاره دارند | **کم**: کد امروز دقیقاً همین مدل است (یک شرکت = یک دیتابیس) |
| بکاپ / بازگردانی / خروج یک مشتری | سخت (باید ردیف‌ها را جدا کرد) | متوسط | **ساده** (کل دیتابیس) |
| کاربر هم‌نام در دو شرکت | نیاز به منطق اضافه | مشکل (auth مشترک) | بدون مشکل (auth جدا) |
| هزینه زیرساخت برای هر شرکت | تقریباً صفر | کم | **حدود ۱۰ دلار در ماه برای هر شرکت** روی Supabase Cloud (قیمت را قبل از فاز ۲ دوباره چک می‌کنیم) |
| اجرای مایگریشن | یک بار | N بار | N بار (با اسکریپت خودکار) |
| مقیاس | هزاران شرکت | ده‌ها تا صدها | صدها؛ بعد از آن انتقال به Postgres روی Hetzner با همین مدل |

### ۳.۲ پیشنهاد: گزینه C، یعنی هر شرکت یک دیتابیس

دلیل‌ها:
1. **خواسته Del** این است که «هر اجاره‌کننده ERP و دیتای مخصوص خودش را داشته باشد». گزینه C این را به معنای واقعی می‌دهد و برای فروش به شرکت‌ها (اعتماد، قرارداد، خروج دیتا) قوی‌ترین جواب است.
2. **ریسک کمتر:** ۱۹۱ policy و ۲۲۹ تابع SECURITY DEFINER که امروز کار می‌کنند دست نمی‌خورند. در گزینه A، هر کدام از این‌ها یک نقطه احتمالی نشت دیتا بین شرکت‌هاست.
3. **شرکت فعلی منتقل نمی‌شود:** دیتابیس فعلی همان دیتابیس مستأجر شماره ۱ است.
4. **قیمت‌گذاری قابل پوشش است:** هزینه حدود ۱۰ دلار زیرساخت در قیمت پلن (حتی کوچک‌ترین پلن) جا می‌شود.

مسیر رشد: وقتی تعداد شرکت‌ها زیاد شد (مثلاً بیش از ۵۰ تا ۱۰۰)، همین مدل «دیتابیس جدا» را روی Postgres خودمان روی Hetzner (چند دیتابیس روی یک کلاستر) اجرا می‌کنیم؛ کد برنامه تغییری نمی‌کند چون فقط آدرس اتصال هر مستأجر عوض می‌شود. برای پلن آزمایشی/رایگان می‌شود دیتابیس را بعد از مدتی عدم استفاده pause کرد.

### ۳.۳ نقشه کلی

```
                      ┌──────────────────────────────┐
  admin.<domain>  ──► │  Control Panel (Next.js)     │──► Control-plane DB (Supabase)
                      │  پلن‌ها، اشتراک، صورتحساب،     │    tenants, plans, subscriptions,
                      │  ساخت شرکت، محدودیت‌ها         │    invoices, payments, domains,
                      └──────────────┬───────────────┘    tenant_secrets (رمزنگاری‌شده)
                                     │ Supabase Management API
                                     ▼ (ساخت پروژه، اجرای مایگریشن)
  acme.<domain>  ──►  ┌──────────────────────────────┐
  erp.del-groups.com  │  ERP App (همین کد، یک دیپلوی) │──► Tenant DB: acme
                      │  proxy.ts: دامنه → مستأجر      │──► Tenant DB: del-groups (دیتابیس فعلی)
                      └──────────────────────────────┘──► Tenant DB: ...
```

### ۳.۴ جزئیات فنی

- **تشخیص مستأجر:** `src/proxy.ts` از روی `Host` مستأجر را پیدا می‌کند (جستجو در control-plane با کش کوتاه‌مدت)، وضعیت اشتراک را چک می‌کند (فعال / فقط‌خواندنی / معلق) و اطلاعات را در هدر/کوکی به بقیه برنامه می‌دهد.
- **کانفیگ زمان اجرا:** آدرس و کلید عمومی Supabase هر مستأجر از `/api/public-config` (بر اساس دامنه) خوانده می‌شود، نه از build. کلاینت‌های `supabaseServer.ts` و `supabaseAdmin.ts` باید به‌جای env ثابت، کانفیگ مستأجر جاری را بگیرند.
- **کلیدهای محرمانه:** service-role key هر مستأجر فقط در control-plane و به‌صورت رمزنگاری‌شده (Supabase Vault) نگه داشته می‌شود؛ هرگز در مرورگر یا لاگ.
- **Auth:** هر مستأجر Supabase Auth خودش را دارد (یوزرها کاملاً جدا). کنترل‌پنل Auth خودش را دارد. Redirect URLهای ایمیل دعوت و بازیابی رمز به‌صورت خودکار موقع ساخت مستأجر تنظیم می‌شود.
- **Storage:** باکت‌های فعلی (`attachments`, `contracts`, تصاویر محصول، مهر) در هر پروژه مستأجر ساخته می‌شوند؛ مصرف حجم برای محدودیت پلن اندازه‌گیری می‌شود.
- **دامنه و SSL:** Caddy با on-demand TLS برای ساب‌دامین‌ها و دامنه‌های اختصاصی گواهی می‌گیرد؛ Caddy قبل از صدور از کنترل‌پنل می‌پرسد آیا این دامنه ثبت شده است.
- **مایگریشن برای همه:** یک اسکریپت در GitHub Actions که بعد از merge، مایگریشن‌های جدید را روی همه دیتابیس‌ها (اول مستأجر تست، بعد بقیه) اجرا می‌کند و نتیجه را در control-plane ثبت می‌کند. اگر روی یکی شکست خورد، بقیه متوقف می‌شوند.
- **AI:** هزینه هر سؤال از قبل در `ai_usage_log` ثبت می‌شود؛ این عدد به control-plane گزارش می‌شود تا سهمیه AI هر پلن اعمال شود.

---

## ۴. کنترل‌پنل اجاره (Rental Control Panel)

### ۴.۱ مدل دیتای control-plane

| جدول | محتوا |
|---|---|
| `tenants` | نام شرکت، slug، وضعیت (`provisioning`, `trial`, `active`, `past_due`, `read_only`, `suspended`, `cancelled`)، کشور، زبان، واحد پول |
| `tenant_databases` | ref پروژه Supabase، region، نسخه schema، آخرین مایگریشن اجراشده |
| `tenant_domains` | ساب‌دامین و دامنه اختصاصی، وضعیت SSL |
| `tenant_secrets` | کلیدها، رمزنگاری‌شده در Vault |
| `modules` | فهرست ماژول‌ها، وابستگی‌ها، قیمت پایه |
| `plans` / `plan_prices` | پلن‌ها (مثلاً Starter / Business / Enterprise)، دوره ماهانه یا سالانه، قیمت هر ماژول برای هر یوزر، تخفیف سالانه |
| `subscriptions` / `subscription_items` | اشتراک فعال هر شرکت، ماژول‌ها، تعداد یوزر، تاریخ تمدید |
| `invoices` / `payments` | صورتحساب، پرداخت، رسید؛ صدور e-qaimə در صورت نیاز |
| `usage_snapshots` | تعداد یوزر فعال، حجم Storage، مصرف AI، روزانه |
| `platform_admins` / `platform_audit_log` | تیم Del Groups و همه کارهای انجام‌شده روی مستأجرها |

### ۴.۲ قیمت‌گذاری (فقط ساختار؛ اعداد را Del تعیین می‌کند)

```
قیمت ماهانه = هزینه پایه پلتفرم
            + Σ (قیمت ماژول برای هر یوزر × تعداد یوزر)
قیمت سالانه = قیمت ماهانه × ۱۲ × (۱ − تخفیف سالانه، مثلاً ۱۷٪ یعنی دو ماه رایگان)
```

- هسته (یوزرها، نقش‌ها، تنظیمات، طرف‌حساب‌ها، محصولات، Studio پایه) در همه پلن‌ها هست.
- بعضی ماژول‌ها به هم وابسته‌اند و کنترل‌پنل آن‌ها را با هم فعال می‌کند (مثلاً «فروش» به «انبار» نیاز دارد، «حقوق» به «منابع انسانی»).
- افزونه‌ها: یوزر اضافه، حجم Storage اضافه، بسته اعتبار AI، دامنه اختصاصی.
- اضافه کردن یوزر یا ماژول در میانه دوره: محاسبه تناسبی (proration).

### ۴.۳ ساخت خودکار شرکت جدید (Provisioning)

1. ثبت‌نام یا ساخت توسط ادمین → ردیف `tenants` با وضعیت `provisioning`.
2. ساخت پروژه Supabase از طریق Management API در region اتحادیه اروپا.
3. اجرای **schema پایه (baseline)** هسته + مایگریشن ماژول‌های انتخاب‌شده.
4. تنظیم Auth (Site URL، Redirect URLها، قالب ایمیل با نام شرکت)، ساخت باکت‌ها.
5. ساخت یوزر ادمین شرکت و ارسال ایمیل دعوت.
6. ویزارد اولیه داخل ERP (نام، لوگو، مهر، VÖEN، ارز، سال مالی، نمودار حساب‌ها) که الان در `settings/initial-setup` نسخه ابتدایی‌اش وجود دارد.
7. وضعیت `trial` یا `active`.

همه مراحل idempotent هستند؛ اگر یکی شکست خورد، از همان‌جا دوباره اجرا می‌شود.

### ۴.۴ اعمال محدودیت‌ها

| محدودیت | کجا اعمال می‌شود |
|---|---|
| تعداد یوزر | موقع دعوت یا فعال کردن یوزر در `/api/users` (سرور با control-plane چک می‌کند) و یک تریگر در دیتابیس مستأجر به‌عنوان لایه دوم |
| ماژول‌ها | جدول `tenant_modules` در دیتابیس مستأجر (همگام با اشتراک): منو، مسیرها در `proxy.ts`، Server Actionها و API، و ابزارهای AI همه از آن پیروی می‌کنند |
| Storage و AI | از روی `usage_snapshots`؛ اول هشدار، بعد جلوگیری از آپلود یا سؤال جدید |
| عدم پرداخت | مهلت → فقط‌خواندنی (دیدن و خروجی گرفتن مجاز، ثبت سند ممنوع) → معلق → حذف بعد از دوره نگه‌داری مشخص و ارائه خروجی کامل دیتا به مشتری |

### ۴.۵ پرداخت

Stripe در آذربایجان برای فروشنده محلی در دسترس نیست (باید تأیید شود)، پس یک **لایه adapter** برای درگاه پرداخت می‌سازیم و اولین درگاه را یک درگاه محلی (مثل Payriff، Epoint یا درگاه بانکی) انتخاب می‌کنیم؛ انتقال بانکی با صورتحساب دستی هم از روز اول پشتیبانی می‌شود. پرداخت تکراری (recurring) با کارت ذخیره‌شده، اگر درگاه پشتیبانی کند.

---

## ۵. هسته + ماژول‌ها (مدل Odoo)

### ۵.۱ هر ماژول یک پوشه با manifest

```
src/modules/
  core/                 # هسته، همیشه نصب
  sales/
    manifest.ts         # id, name, version, depends, permissions, menus, routes, settings, ai tools
    migrations/         # SQL مخصوص این ماژول (فقط موقع نصب اجرا می‌شود)
    components/  lib/  actions/
  inventory/  purchases/  accounting/  production/  polywood/  hr/  payroll/
  crm/  contracts/  consignment/  commissions/  expenses/  tax-az/  barcode/  ai/  studio/
```

نمونه manifest:

```ts
export default defineModule({
  id: "sales",
  version: "1.0.0",
  depends: ["core", "inventory", "accounting"],
  permissions: ["sales.read", "sales.create", "sales.post", "sales.void"],
  menus: [{ path: "/sales", label: "nav.sales", icon: "ShoppingCart" }],
  routes: ["/sales", "/sales/new", "/sales/[id]"],
  aiTools: ["search_sales", "get_sale"],
  settings: [{ key: "sales.default_vat", type: "percent" }],
});
```

### ۵.۲ هسته (Core)

یوزرها، نقش‌ها و دسترسی‌ها، شرکت و تنظیمات، طرف‌حساب‌ها (`partners`)، محصولات و دسته‌ها، واحدها و ارز، شماره‌گذاری اسناد، پیوست‌ها، audit log، chatter و activityها (از فاز ۳ برنامه Studio)، Studio، رجیستری ماژول‌ها، اعلان‌ها.

### ۵.۳ نحوه کار

- **رجیستری:** همه manifestها در build جمع می‌شوند. منو (`navConfig.ts`)، دسترسی مسیرها (`routePermissions.ts`) و ماتریس دسترسی (`permissionMatrix.ts`) به‌جای فهرست ثابت از رجیستری و `tenant_modules` ساخته می‌شوند.
- **نصب ماژول:** کنترل‌پنل ماژول را در اشتراک فعال می‌کند → مایگریشن‌های آن ماژول روی دیتابیس مستأجر اجرا می‌شود → ردیف `tenant_modules`. حذف ماژول دیتا را پاک نمی‌کند، فقط مخفی می‌کند.
- **وابستگی بین ماژول‌ها:** مثل حسابداری که از فروش و خرید سند می‌گیرد، از طریق `erp_events` موجود و hookهای تعریف‌شده انجام می‌شود، نه import مستقیم. این‌طوری نصب‌نبودن یک ماژول چیزی را نمی‌شکند.
- **Next.js:** صفحات در `src/app` می‌مانند (محدودیت App Router)، ولی فقط یک لایه نازک هستند که کامپوننت ماژول را صدا می‌زنند؛ نگهبان مسیر در `proxy.ts` اگر ماژول نصب نباشد صفحه «این ماژول در پلن شما نیست» نشان می‌دهد.
- **Schema پایه:** ۱۱۷ مایگریشن + ۳۵ فایل `types/*.sql` به یک baseline تمیز هسته و یک baseline برای هر ماژول تبدیل می‌شوند (از روی schema واقعی دیتابیس فعلی تولید می‌شود). یک تست CI هر بار یک دیتابیس خالی می‌سازد و مطمئن می‌شود همه چیز بدون خطا اجرا می‌شود.

### ۵.۴ ماژول‌های جدید و ارتقای ماژول‌های فعلی (بند ۸ پیام Del)

وضعیت فعلی CRM: فقط جدول `deals` با مرحله ثابت (`LEAD` …)، یک مبلغ، مسئول و یادداشت، به‌علاوه پیش‌فاکتور (`quotations`). تقویم، کارها (To-do)، فعالیت‌ها و مدیریت اسناد وجود ندارد.

| اولویت | ماژول | محتوا (الگو از اپ هم‌نام در Odoo) | وابستگی |
|---|---|---|---|
| ۱ | **Activities + Chatter (هسته)** | فعالیت زمان‌دار روی هر رکورد (تماس، جلسه، ایمیل، کار)، یادداشت و پیام، دنبال‌کننده‌ها، تاریخچه تغییرات | پایه همه ماژول‌های زیر |
| ۱ | **Calendar** | تقویم کاری شخصی و تیمی (روز/هفته/ماه)، جلسه با شرکت‌کننده، تکرار، یادآور، اتصال به فعالیت‌ها، همگام‌سازی با Google/Outlook در مرحله دوم | Activities |
| ۱ | **CRM (بازنویسی)** | Lead و Opportunity جدا، مراحل قابل تنظیم برای هر تیم، Kanban با drag، احتمال و درآمد پیش‌بینی‌شده، دلیل باخت، تیم فروش و هدف، امتیازدهی Lead، تبدیل به پیش‌فاکتور و فاکتور فروش، گزارش قیف و پیش‌بینی | Activities، Calendar، Sales |
| ۱ | **To-do** | کارهای شخصی با مرحله‌های شخصی، برچسب، اولویت، تبدیل به کار پروژه | Activities |
| ۲ | **Documents** | پوشه‌ها (Workspace)، برچسب، پیش‌نمایش PDF/عکس، اتصال فایل به هر رکورد، درخواست سند از کارمند یا مشتری، دسترسی به پوشه | Storage، Activities |
| ۲ | **Project + Timesheets** | پروژه، کار، زیرکار، Kanban، Gantt، ثبت ساعت کار، اتصال به تولید و هزینه | Activities، HR |
| ۲ | **Discuss** | کانال‌های گفتگوی داخلی و پیام مستقیم | Chatter |
| ۲ | **Approvals** | درخواست‌های تأیید عمومی (خرید، مرخصی، هزینه) با چند مرحله؛ همان فاز ۳ برنامه Studio | Activities |
| ۳ | **Knowledge** | ویکی داخلی شرکت | — |
| ۳ | **Helpdesk** | تیکت مشتری، SLA، تیم پشتیبانی | CRM |
| ۳ | **Sign** | امضای الکترونیکی قرارداد | Documents، Contracts |
| ۳ | **Maintenance / Quality / Fleet** | نگه‌داری دستگاه‌های تولید، کنترل کیفیت، خودروها | Production، Inventory |
| ۳ | **Recruitment / Time Off / Attendance / Appraisals** | تکمیل منابع انسانی | HR |
| ۴ | **POS / Website / eCommerce / Email Marketing / Surveys** | بعد از پایلوت و بر اساس تقاضای مشتری‌ها | — |

فهرست نهایی و جزئیات هر کدام بعد از گزارش Odoo (بخش ۸) قطعی می‌شود. هر ماژول جدید از روز اول با manifest و روی موتور View جدید ساخته می‌شود، پس به UI قدیمی چیزی اضافه نمی‌شود.

### ۵.۵ کپی کردن Odoo: مرز قانونی

Odoo Community تحت LGPL و Odoo Enterprise تحت لایسنس اختصاصی است. **از Odoo مفهوم، ساختار و جریان کار را الگو می‌گیریم، نه کد، آیکون، متن یا برند را.** UI ما طراحی خودمان است. این برای فروش تجاری محصول مهم است.

---

## ۶. UI/UX جدید

### ۶.۱ ساختار (الگو از Odoo)

- **صفحه اصلی App Launcher:** شبکه آیکون ماژول‌های نصب‌شده با کارت KPI زنده زیر هر کدام.
- **نوار بالا:** نام ماژول، منوهای ماژول، جستجوی سراسری (`cmdk` موجود است)، اعلان‌ها، دستیار AI، سوئیچ شرکت (برای یوزر چندشرکتی در آینده).
- **موتور View عمومی:** List، Kanban، Form، Pivot، Graph، Calendar، Map. تعریف هر view از metadata (ادامه رجیستری Studio)، تا فیلد سفارشی خودکار همه‌جا ظاهر شود.
- **Control panel هر لیست:** فیلتر، Group by، علاقه‌مندی‌ها، جستجوی ذخیره‌شده، خروجی Excel.
- **Form:** نوار وضعیت (Draft → Posted …)، دکمه‌های اقدام، تب‌ها، **Chatter** در کنار (یادداشت، پیام، تاریخچه تغییرات، فعالیت‌ها).
- **Breadcrumb** برای مسیر رفت و برگشت بین اسناد مرتبط.

### ۶.۲ مدرن‌تر از Odoo

- **موشن:** کتابخانه `motion` (Framer Motion) برای انتقال بین صفحه‌ها، باز شدن رکورد از لیست (shared layout)، drag در Kanban، شمارش اعداد KPI؛ همه با رعایت `prefers-reduced-motion` و بودجه ۲۰۰ تا ۳۰۰ میلی‌ثانیه.
- **اینفوگراف:** داشبورد هر ماژول با کارت‌های KPI، sparkline، نمودار قیف فروش، نقشه حرارتی موجودی انبار، Sankey جریان نقدینگی، گیج اهداف. Recharts موجود برای نمودار ساده؛ برای نمودارهای پیشرفته ECharts یا visx.
- **سیستم طراحی:** توسعه `src/design-system/tokens.*` موجود: رنگ‌بندی برند قابل تنظیم برای هر مستأجر (لوگو و رنگ اصلی)، حالت تیره، فونت مناسب لاتین/سیریلیک، تراکم قابل انتخاب (فشرده/راحت).
- **موبایل و PWA:** PWA موجود است؛ Kanban و Form برای موبایل بازطراحی می‌شوند (اسکن بارکد در انبار).
- **AI در متن:** دکمه «از AI بپرس» روی هر لیست و داشبورد، با زمینه همان صفحه.

### ۶.۳ منبع طرح‌های UI: vibeprompts.dev (بند ۷ پیام Del)

سایت [vibeprompts.dev](https://vibeprompts.dev/) حدود ۲۸۶ پرامپت در ۱۵ دسته دارد. هر صفحه یک پرامپت متنی و کد آماده HTML + Tailwind (و در بعضی‌ها JavaScript ساده) دارد. روش استفاده:

- **کد را مستقیم کپی نمی‌کنیم.** پرامپت و کد هر بخش مرجع ظاهر و رفتار است. Claude Code آن را به کامپوننت React + TypeScript در `src/design-system` تبدیل می‌کند، با tokenهای ما، Radix برای دسترس‌پذیری و `motion` برای انیمیشن. JavaScript ساده (مثل drag در Kanban) با معادل React جایگزین می‌شود.
- استفاده از سایت رایگان است (تأیید Del، 2026-10-11).
- **نسخه کامل محلی:** همه ۲۸۶ پرامپت و کد در `docs/ui-library/vibeprompts/` کپی شده است. برای هر کامپوننت یک فایل پیش‌نمایش `.html` هست و برای هر دسته یک `README.md` با متن پرامپت‌ها. Claude Code آن‌ها را بدون اینترنت می‌خواند. مسیر هر صفحه در جدول زیر همان مسیر فایل در این پوشه است، مثلاً `dashboards/dashboards-kanban-board-with-drag-and-drop` یعنی `docs/ui-library/vibeprompts/dashboards/dashboards-kanban-board-with-drag-and-drop.html`.

نقشه بخش‌های سایت به نیاز ERP:

| نیاز ERP | صفحه vibeprompts.dev |
|---|---|
| App Launcher و منوی بالا | `nav/nav-multi-product-launcher-nav`, `nav/nav-app-bar-with-search-and-tabs`, `nav/nav-workspace-switcher-nav`, `nav/nav-breadcrumb-page-header`, `nav/nav-mobile-drawer-menu`, `nav/nav-bottom-tab-bar` |
| List view و نوار جستجو/فیلتر | `dashboards/dashboards-data-table-with-toolbar` |
| Kanban (CRM، To-do، Project، تولید) | `dashboards/dashboards-kanban-board-with-drag-and-drop` |
| Calendar | `dashboards/dashboards-week-schedule-grid`, `stats/stats-contribution-rhythm-calendar` |
| داشبورد و KPI | `dashboards/dashboards-sidebar-stat-cards`, `dashboards/dashboards-analytics-overview-with-range-chips`, `dashboards/dashboards-chart-card-with-legend`, `dashboards/dashboards-regional-performance-board` |
| اینفوگراف | `stats/stats-metric-cards-with-sparkline-bars`, `stats/stats-ring-gauge-trio`, `stats/stats-conversion-funnel-steps`, `stats/stats-goal-progress-bars`, `stats/stats-cohort-retention-heatmap`, `stats/stats-count-up-metrics-on-view`, `stats/stats-leaderboard-with-rank-movement`, `stats/stats-week-over-week-delta-table`, `stats/stats-anomaly-pulse-strip` |
| انبار | `dashboards/dashboards-inventory-replenishment-cockpit` |
| Chatter و فعالیت‌ها | `dashboards/dashboards-activity-feed-panel`, `blog/blog-comment-thread-with-replies` |
| Approvals | `dashboards/dashboards-approvals-queue-with-detail-drawer` |
| Discuss / صندوق پیام | `dashboards/dashboards-inbox-split-view` |
| یوزرها و نقش‌ها | `dashboards/dashboards-team-and-roles-admin`, `features/features-permission-inheritance-explorer`, `auth/auth-active-sessions-manager` |
| ورود، دعوت، 2FA | `auth/auth-split-screen-with-visual`, `auth/auth-workspace-invite-acceptance`, `auth/auth-two-factor-setup-with-qr`, `auth/auth-reset-password-with-strength-meter`, `auth/auth-trial-signup-with-plan-summary` |
| ویزارد راه‌اندازی شرکت جدید | `onboarding/onboarding-stepper-progress`, `onboarding/onboarding-brand-your-workspace-step`, `onboarding/onboarding-invite-teammates-step`, `onboarding/onboarding-csv-column-mapping-step`, `onboarding/onboarding-sample-data-or-your-own`, `onboarding/onboarding-checklist-card`, `onboarding/onboarding-setup-complete-celebration` |
| کنترل‌پنل: پلن و صورتحساب | `pricing/pricing-module-bundle-builder`, `pricing/pricing-per-seat-pricing-with-quantity-stepper`, `pricing/pricing-change-plan-with-prorated-preview`, `pricing/pricing-comparison-table`, `pricing/pricing-prices-in-local-currency`, `dashboards/dashboards-usage-and-billing-meters`, `cta/cta-seat-limit-collaboration-nudge`, `cta/cta-in-app-upgrade-nudge`, `cta/cta-renewal-reminder-banner` |
| سایت فروش محصول | دسته‌های `hero`, `features`, `pricing`, `testimonials`, `faq`, `cta`, `footer`, `contact` (مثلاً `contact/contact-demo-booking-with-time-slots`) |
| اجزای عمومی | `bonus/bonus-command-palette`, `bonus/bonus-toast-notification`, `bonus/bonus-empty-state`, `bonus/bonus-skeleton-loading-state`, `bonus/bonus-file-upload-dropzone`, `bonus/bonus-type-to-confirm-delete-dialog`, `bonus/bonus-keyboard-shortcuts-sheet` |

برای List، Form، Pivot و Gantt که در سایت نمونه مستقیم ندارند، طرح از روی گزارش Odoo و با همین سیستم طراحی ساخته می‌شود.

### ۶.۴ روش اجرا

پوسته جدید پشت یک feature flag ساخته می‌شود و **ماژول به ماژول** جایگزین می‌شود (اول یک ماژول ساده مثل CRM برای امتحان موتور View، بعد فروش، انبار و …). UI قدیمی تا پایان انتقال کار می‌کند. قبل از کدنویسی، طرح Figma یا یک نمونه کلیک‌پذیر از ۵ صفحه کلیدی برای تأیید Del آماده می‌شود.

---

## ۷. انتقال دیتای شرکت فعلی (Del Groups)

چون مدل «هر شرکت یک دیتابیس» است، **دیتای فعلی جابه‌جا نمی‌شود**:

1. پروژه Supabase فعلی `del-groups-erp` در control-plane به‌عنوان مستأجر شماره ۱ ثبت می‌شود و `erp.del-groups.com` به آن اشاره می‌کند.
2. مایگریشن‌های جدید (`tenant_modules`، تنظیمات شرکت به‌جای مقادیر ثابت) مثل همیشه و با اجازه Del روی آن اجرا می‌شوند.
3. مقادیر ثابت Del Groups در ۴۱ فایل کد به `system_settings` منتقل می‌شوند و با همان مقادیر فعلی پر می‌شوند، تا ظاهر برای کارمندان عوض نشود.
4. قبل از هر قدم: بکاپ کامل (pg_dump) و تست روی یک کپی (Supabase branch یا پروژه تست).
5. یک دیتابیس «شرکت نمونه» با دیتای ساختگی برای دمو و فروش ساخته می‌شود (هرگز از دیتای واقعی Del Groups برای دمو استفاده نمی‌کنیم).

---

## ۸. بررسی حساب Odoo با Chrome (بند ۵ پیام Del)

**هدف:** نصب همه اپ‌ها از بخش Apps در دیتابیس تست Odoo و تهیه یک گزارش فنی ساختاری برای هر اپ (مدل‌ها و فیلدها، viewها، جریان کار و وضعیت‌ها، تنظیمات، گزارش‌ها، اتوماسیون‌ها) با استفاده واقعی مثل یک شرکت (ساخت محصول، فروش، خرید، انبار، تولید، حسابداری، حقوق)، و مقایسه با ERP خودمان.

**چه چیزی از Del لازم است:**
1. یک **دیتابیس تست یا trial** در Odoo (نه دیتابیس واقعی شرکت)، چون قرار است دیتای آزمایشی ثبت شود.
2. یک **یوزر جداگانه** برای این کار با دسترسی لازم، که بعداً بشود غیرفعالش کرد.
3. **Claude in Chrome** روی کامپیوتر Del که به یک thread این پروژه وصل باشد. Del خودش در Chrome وارد Odoo می‌شود؛ **رمز عبور هرگز در چت فرستاده نمی‌شود.**
4. فهرست اپ‌هایی که بیشتر برایش مهم است (پیشنهاد: Sales، Inventory، Purchase، Manufacturing، Accounting، Studio، Documents، Approvals).

**خروجی:** `docs/Odoo-Structural-Report.md` در repo + جدول gap برای هر ماژول ما.
**زمان اجرا:** موازی با فاز ۲، قبل از شروع فاز ۴ (UI)، چون نتیجه‌اش طراحی موتور View و ماژول‌ها را تغذیه می‌کند.

---

## ۹. فازها و ترتیب

هر فاز یک یا چند branch و PR جدا، و هر فاز پشت feature flag، تا سیستم زنده Del Groups در طول کار عوض نشود.

| فاز | محتوا | اندازه | پیش‌نیاز |
|---|---|---|---|
| **۰. تصمیم و آماده‌سازی** | تأیید این سند؛ انتخاب نام و دامنه محصول؛ اعداد پلن‌ها؛ انتخاب درگاه پرداخت | کوچک | — |
| **۱. پایه فنی** | Schema پایه قابل تکرار (baseline) + تست CI ساخت دیتابیس خالی؛ کانفیگ runtime به‌جای build؛ انتقال مقادیر ثابت Del Groups به تنظیمات؛ تمیز کردن مایگریشن‌ها | بزرگ | ۰ |
| **۲. هسته و ماژول‌ها** | `src/modules` + manifest + رجیستری؛ منو و دسترسی از رجیستری؛ `tenant_modules`؛ انتقال ماژول‌ها یکی‌یکی بدون تغییر ظاهر | بزرگ | ۱ |
| **۳. کنترل‌پنل MVP** | دیتابیس control-plane؛ تشخیص مستأجر در `proxy.ts`؛ ساخت خودکار شرکت؛ مایگریشن برای همه؛ ثبت Del Groups به‌عنوان مستأجر ۱؛ SSL ساب‌دامین | بزرگ | ۱، ۲ |
| **۴. پلن، محدودیت و پرداخت** | پلن‌ها و قیمت‌ها، اشتراک، صورتحساب، درگاه، محدودیت یوزر/ماژول/Storage/AI، مهلت و تعلیق | متوسط | ۳ |
| **۵. بررسی Odoo** | گزارش ساختاری (بخش ۸) | متوسط | دسترسی از Del؛ موازی با ۳ و ۴ |
| **۶. UI/UX جدید** | طرح و تأیید؛ پوسته و App Launcher؛ موتور View؛ Chatter؛ داشبوردها؛ انتقال ماژول به ماژول | خیلی بزرگ | ۲ و ۵ |
| **۶ب. ماژول‌های جدید** | Activities/Chatter، Calendar، CRM جدید، To-do، بعد Documents و Project و بقیه (بخش ۵.۴) روی موتور View جدید | خیلی بزرگ | ۲، ۵ و پوسته فاز ۶ |
| **۷. آماده‌سازی فروش** | سایت معرفی و ثبت‌نام، شرکت دمو، شرایط استفاده و قرارداد پردازش داده، مستندات کاربری، پشتیبانی، مانیتورینگ و بکاپ خودکار هر مستأجر | متوسط | ۴ |
| **۸. پایلوت** | ۲ تا ۳ شرکت آزمایشی با قیمت ویژه، جمع‌آوری بازخورد، بعد فروش عمومی | — | ۶، ۷ |

پرامپت آماده Claude Code برای هر فاز در [`docs/claude-code-prompts.md`](claude-code-prompts.md) است.

ادامه برنامه Studio و AI (اتوماسیون، تأییدها، ابزارهای نوشتن AI) داخل فاز ۲ و ۶ ادغام می‌شود چون همان رجیستری metadata را لازم دارد.

---

## ۱۰. ریسک‌ها

| ریسک | اثر | کاهش ریسک |
|---|---|---|
| خراب شدن سیستم زنده Del Groups در حین بازسازی | بالا | هر تغییر پشت flag؛ بکاپ قبل از هر مایگریشن؛ تست روی کپی دیتابیس؛ مستأجر تست قبل از مستأجر ۱ |
| Schema پایه با دیتابیس واقعی فرق داشته باشد (مایگریشن‌های دستی گذشته) | بالا | baseline را از روی خود دیتابیس زنده تولید می‌کنیم و با diff خودکار مقایسه می‌کنیم |
| مایگریشن روی یکی از N دیتابیس شکست بخورد | متوسط | اجرای مرحله‌ای، توقف خودکار، ثبت نسخه هر مستأجر در control-plane |
| هزینه Supabase با رشد تعداد شرکت | متوسط | قیمت پلن حداقل هزینه را پوشش دهد؛ pause مستأجرهای غیرفعال؛ مسیر انتقال به Postgres روی Hetzner |
| محدودیت‌های Supabase Management API یا سقف تعداد پروژه | متوسط | قبل از فاز ۳ با پشتیبانی Supabase یا پلن مناسب سازمانی چک می‌شود |
| درگاه پرداخت محلی پرداخت تکراری را پشتیبانی نکند | متوسط | adapter + صورتحساب دستی + یادآوری؛ پیش‌پرداخت سالانه |
| بازسازی کامل UI بیش از حد طول بکشد | بالا | انتقال ماژول به ماژول؛ UI قدیمی تا آخر کار می‌کند؛ اول یک ماژول ساده |
| مسائل قانونی کپی از Odoo | متوسط | فقط مفهوم و ساختار؛ بدون کد، آیکون، متن یا برند Odoo |
| امنیت (کلید مستأجرها، دسترسی تیم پشتیبانی به دیتای مشتری) | بالا | Vault، audit log پلتفرم، دسترسی پشتیبانی فقط با اجازه مشتری و محدود به زمان |
| قوانین داده (محل نگه‌داری دیتا، حریم خصوصی) | متوسط | region اتحادیه اروپا، قرارداد پردازش داده، خروجی کامل دیتا برای مشتری |
| تمرکز همه چیز روی یک سرور Hetzner | متوسط | مانیتورینگ، بکاپ خارج از سرور، امکان اجرای دو کانتینر و سرور دوم در فاز ۷ |

---

## ۱۱. تصمیم‌هایی که از Del لازم است

1. تأیید مدل «هر شرکت یک دیتابیس» (پیشنهاد) یا انتخاب دیگر.
2. نام محصول و دامنه (مثلاً `<name>.az`) برای ساب‌دامین مشتری‌ها.
3. فهرست پلن‌ها و قیمت اولیه هر ماژول و هر یوزر، و تخفیف سالانه.
4. درگاه پرداختی که شرکت با آن قرارداد دارد یا می‌تواند داشته باشد.
5. زمان مناسب برای بخش Odoo و آماده کردن دیتابیس تست و یوزر جداگانه.
6. بازار هدف اول (فقط آذربایجان یا کشورهای دیگر) که روی زبان، مالیات و ارز اثر دارد.
