# خروجی فاکتور با فرمت، طراح قالب فاکتور، و یکی کردن جدول سطرها (۲۰۲۶-۱۱-۱۱)

همه پرامپت‌ها در همین یک فایل و به ترتیب اجرا هستند. هر پرامپت را کامل (از خط `----` تا پایان بخشش) در Claude Code (VS Code) بدهید.
هر پرامپت یک شاخه و یک PR دارد. PR را merge کنید و اگر SQL دارد اجرا کنید، بعد پرامپت بعدی.

## خلاصه برای Del

### ۱. چرا اکسل فعلی بی‌فرمت است

خروجی اکسل فاکتور (INV-2) با کتابخانه `xlsx` (SheetJS نسخه 0.18.5، نسخه رایگان) ساخته می‌شود. این نسخه **اصلاً نمی‌تواند** رنگ، کادر، پس‌زمینه، ادغام سلول، لوگو یا تنظیم چاپ بنویسد. کد فعلی فقط با یک ترفند چند ردیف را bold می‌کند (`patchBoldRows` در `src/lib/export/invoiceExport.ts`). برای همین فایل شما فقط برچسب و مقدار است.
PDF با `pdfmake` ساخته می‌شود که طراحی کامل دارد، برای همین خوب درآمده.

**راه‌حل:** برای نوشتن فاکتور اکسل از کتابخانه **ExcelJS** (رایگان، MIT) استفاده شود که رنگ، کادر، ادغام، لوگو، فرمت عدد، تنظیم صفحه A4 و چاپ را پشتیبانی می‌کند. فقط هنگام کلیک بارگذاری می‌شود، پس سرعت صفحه‌ها تغییر نمی‌کند. خروجی لیست‌ها فعلاً همان SheetJS می‌ماند (جابه‌جایی آن جداگانه در لیست کارهای باز هست).

### ۲. طراح قالب فاکتور («Faktura dizaynı»)

یک بخش جدید در تنظیمات، فقط برای ادمین، که در آن برای هر نوع سند (فاکتور فروش رسمی/عادی، فاکتور خرید، و بعداً امانی، پیش‌فاکتور، انتقال انبار…) قالب ساخته می‌شود:

- سمت چپ: **جعبه بلوک‌ها** (سربرگ شرکت با لوگو، عنوان، مشخصات سند، مشتری/تأمین‌کننده، جدول کالاها، جمع‌ها، پرداخت‌ها، یادداشت، اطلاعات بانکی، امضا و مهر، متن آزاد، تصویر، خط جداکننده، فاصله، مبلغ به حروف).
- وسط: **صفحه A4** که بلوک‌ها با کشیدن و رها کردن (drag & drop) روی آن چیده می‌شوند، در ردیف‌های یک، دو یا سه ستونی.
- سمت راست: **تنظیمات بلوک انتخاب‌شده** (کدام فیلدها، کدام ستون‌های جدول و ترتیب و عرضشان، رنگ، اندازه فونت، متن به سه زبان).
- بالا: پیش‌نمایش با یک فاکتور واقعی، دانلود آزمایشی PDF و Excel، ذخیره، تکثیر، «بازگشت به قالب پیش‌فرض سیستم».

**یک قالب، سه خروجی:** همان قالب برای چاپ، PDF و Excel استفاده می‌شود. پس آنچه طراحی می‌کنید در هر سه یکی است.

**تصمیم مهم (پیشنهاد من):** چیدمان «ردیف و ستون» است، نه جابه‌جایی آزاد پیکسلی مثل فتوشاپ. دلیل: (الف) اکسل جدولی است و جای آزاد پیکسلی در آن معنی ندارد، (ب) فاکتورهای طولانی چند صفحه می‌شوند و فقط چیدمان جریانی درست به صفحه بعد می‌رود، (ج) روی موبایل و زبان‌های مختلف به هم نمی‌ریزد. کشیدن و رها کردن کاملاً هست، فقط بلوک‌ها در شبکه ردیف و ستون می‌نشینند. اگر جابه‌جایی آزاد پیکسلی می‌خواهید بگویید تا پرامپت TPL-2 عوض شود.

تا وقتی قالبی نساخته‌اید، همه چیز دقیقاً مثل امروز چاپ و خروجی می‌شود (قالب‌های پیش‌فرض سیستم همان طرح فعلی هستند).

### ۳. جدول سطرهای فرم فروش هنوز مدل قدیمی است

درست دیدید. در PR #85 (UI-3) جدول یکسان سطرها (`LineGrid`) ساخته شد و خرید، واردات، امانی (ارسال، تسویه، مانده اول دوره، برگشت)، انتقال، ضایعات، مانده اول دوره انبار و پیش‌فاکتور به آن منتقل شدند، ولی **فرم فاکتور فروش** (`src/modules/sales/components/InvoiceForm.tsx`، ۳۳۰۰ خط با ۲۸ لیست کشویی قدیمی) هیچ‌وقت منتقل نشد. ممیزی UI-7 هم همین را ثبت کرده (`FORM-01` در `docs/ui-system/audit.md`). چند فرم دیگر هم جدول قدیمی دارند: فروش پلی‌وود (`MixedDimensionalInvoiceForm`)، سطرهای انبارگردانی و مراحل تولید. فرم‌های امانی که در منو هستند الان با `LineGrid` هستند (اگر جایی را قدیمی دیدید عکس بفرستید). یک فایل قدیمی بدون استفاده هم هست (`ConsignmentInvoiceForm.tsx`) که حذف می‌شود.
پرامپت UNI-1 فرم فروش را منتقل می‌کند و UNI-2 بقیه را.

### ترتیب اجرا

| # | پرامپت | شاخه | SQL | بعد از merge |
|---|---|---|---|---|
| 1 | XLS-1 اکسل فاکتور با فرمت کامل | `saas/invoice-xlsx-styled` | ندارد | هیچ (پشت همان فلگ `INVOICE_TOOLS` که روشن است، پس فوراً دیده می‌شود) |
| 2 | UNI-1 جدول سطرهای فاکتور فروش روی LineGrid | `saas/sales-line-grid` | ندارد | اول فقط ادمین‌ها می‌بینند (`UI_UNIFIED`)؛ بعد از تست شما، UNI-1b آن را برای همه روشن می‌کند |
| 3 | UNI-2 بقیه فرم‌های سطردار | `saas/line-grid-rest` | ندارد | همان |
| 4 | TPL-1 مدل قالب، جدول دیتابیس، موتور سه خروجی | `saas/doc-templates-core` | `20261125100000_document_templates.sql` | SQL را اجرا کنید؛ فلگ هنوز خاموش |
| 5 | TPL-2 صفحه طراح با کشیدن و رها کردن | `saas/doc-templates-designer` | ندارد | `INVOICE_DESIGNER=true` (فقط ادمین صفحه را می‌بیند) |
| 6 | TPL-3 اتصال چاپ، PDF و اکسل به قالب پیش‌فرض | `saas/doc-templates-wiring` | ندارد | قالب بسازید، «پیش‌فرض» کنید، چاپ بگیرید |
| 7 | TPL-4 سندهای دیگر + مهر و امضا + مبلغ به حروف | `saas/doc-templates-more-docs` | فقط اگر لازم شد (`20261125110000_...`) | SQL اگر بود |

XLS-1 و UNI-1 به هم وابسته نیستند و هر کدام را می‌شود اول اجرا کرد. TPL-1 تا TPL-4 باید به ترتیب باشند. TPL-1 بعد از XLS-1 باشد چون نویسنده اکسل جدید را دوباره استفاده می‌کند.

**هشدار جدا (ربطی به این کار ندارد):** پیشوند `20261112100000` که در پرامپت LOT-1 برای `lot_core` نوشته شده، حالا در main گرفته شده (`20261112100000_gl_partner_tags.sql`). وقتی به LOT-1 رسیدید به Claude Code بگویید پیشوند آزاد دیگری انتخاب کند (مثلاً `20261126100000_lot_core` و LOT-2/3/5 هم به ترتیب بعد از آن).

---

## XLS-1: اکسل فاکتور با فرمت کامل

----
Before starting, check the list of available skills. Use every skill that fits this task
(xlsx, frontend-design, design-system, testing, code-review, and any others that fit). At the
end, say which skills you used, or that none fit. If a skill or tool you need is missing, stop
and tell me exactly what to install.

Task XLS-1: the invoice Excel download (INV-2) must look like a real, printable invoice, not a
list of label/value rows. Today it is written with SheetJS community 0.18.5 ("xlsx"), which
cannot write styles; only bold rows are patched in (patchBoldRows in
src/lib/export/invoiceExport.ts). The PDF from the same data is good: make the Excel file match
it.

Follow CLAUDE.md "SaaS program rules". Branch: saas/invoice-xlsx-styled from the latest main.
Open a draft PR. This is a fix of an existing feature that is already behind INVOICE_TOOLS (on in
production): keep it behind the same flag, no new flag, and say so in the PR as the rule-6
exception. With INVOICE_TOOLS off nothing changes. List exports (exportXlsx.ts) are NOT part of
this task and keep using SheetJS.

Library:
- Write the invoice .xlsx with ExcelJS (MIT). Pin an exact version. Load it only on click with a
  dynamic import in src/lib/export/invoiceExportDownload.ts (as pdfmake is), so no page bundle
  grows; check with the build output and say the size in the PR.
- Run `npm audit` after adding it and paste the result for ExcelJS in the PR. We only write
  files with it (never read user files with it). If audit shows a high or critical issue that
  affects writing, stop and tell me.
- Keep the pure part testable in Node: a function that takes the ExcelJS module as a parameter
  and returns a Workbook (like writeInvoiceXlsxBytes takes XLSX today). Remove patchBoldRows and
  the SheetJS path for invoices once the new writer is in (keep exportXlsx.ts for lists).

Layout of the sheet (A4 portrait, one sheet named after the document number, same data as now
from InvoiceExportDoc / saleToExportDoc / purchaseToExportDoc, same official/unofficial rule as
pdfShowsCompany):
1. Header band: company logo (from branding.logoUrl, PNG/JPEG only, fetched the same way as the
   PDF does; if it cannot be read the file is made without it) at top left over about 3 rows;
   company name (bold, 14 pt), VÖEN, address, phone next to it. Document title on the right
   ("SATIŞ FAKTURASI" style, bold 16 pt, accent colour), document number and date under it.
   Draft / cancelled: the mark in a coloured, bold cell next to the title (amber / red), and the
   status in the info block.
2. Info block in two pairs of columns (as in the PDF): customer/supplier, VÖEN, warehouse,
   salesperson/responsible, currency (+ rate when not 1), created by, status. Labels in muted
   grey, values bold. Merge cells so long values do not spill.
3. Lines table: header row with a filled background (slate-100 or the accent at low tint), bold,
   centred, thin borders on all cells, wrap text on, row height fits two lines. Columns: No.,
   product, code, unit, quantity, price, discount, VAT %, total (+ currency column only when a
   line has another currency, as today). Zebra fill on every second row (very light). Number
   formats: quantity `#,##0.00#`, money `#,##0.00`, VAT `0.##"%"`, No. integer. Numbers stay
   real numbers (not text). Right-align numbers, left-align text.
4. Totals block under the Total column, right side: subtotal, discount (only if > 0, as the
   PDF), VAT (only where the PDF shows it), extra costs (only if > 0), grand total (bold, top
   double border, filled), paid, remaining (bold). Keep the stored values (as the print does),
   not formulas, so the file always equals the invoice; add the currency code in the number
   format (e.g. `#,##0.00 "AZN"`).
5. Payments table (if any) with the same table style, then notes in a merged, wrapped cell.
6. Signature lines at the bottom: two cells with a top border ("Təhvil verdi" / "Təhvil aldı" for
   sales, matching labels for purchases; new i18n keys in az, en, ru under invoiceTools.export).

Sheet and print settings:
- Column widths chosen so the table fits A4 portrait width at 100 % (product column takes the
  rest); fitToWidth = 1, fitToHeight = 0; margins as the PDF; the lines header row repeats on
  every printed page (printTitlesRow); freeze panes under the lines header is NOT wanted (the
  header block is above it), so no freeze.
- Header/footer for printing: footer "Page &P of &N" in the user's language (the existing
  invoiceTools.export.page text) and the document number on the left.
- Gridlines hidden in view and print, zoom 100, default font Calibri 10 (Excel default family so
  Azerbaijani letters ə, ğ, ı, ö, ş, ü, ç show everywhere).
- Workbook properties: title "<title> <doc no>", creator = company name.

Colours: take them from the design tokens (src/design-system) as hex constants in one place
(ink, muted, line, header fill, accent, draft amber, cancelled red), the same ones the PDF part
uses (INK, MUTED, LINE, HEAD_BG, MARK_COLOR in invoiceExport.ts). Move them to a shared
constant so PDF and Excel use the same values.

Tests (Node, existing test runner):
- Build the workbook for a sale with 3 lines (one foreign currency, one with discount), for a
  draft, a cancelled and an official sale, and for a purchase. Check: sheet name, merged header
  cells, header row fill and borders, number formats and that amounts are numbers, totals equal
  the doc totals, logo added only when a data URL is given, the currency column only when
  needed, print setup (A4, fitToWidth, printTitlesRow), Azerbaijani text kept.
- Write a sample file with a script (scripts/ or the existing sample script INV-2 used) and
  attach a screenshot of it opened in LibreOffice (headless convert to PDF, then image) to the
  PR so I can see the look without running it.

UI rules: no visible UI change in the app except the file itself; if any label changes, follow
docs/ui-standard.md and list rule ids in the PR.

Before the PR: npm run lint, npm test, npm run build. PR text: what changed in plain words, the
screenshot, how it was tested, bundle size, npm audit result, no manual step (flag already on).

----

## UNI-1: جدول سطرهای فاکتور فروش روی LineGrid

----
Before starting, check the list of available skills. Use every skill that fits this task
(frontend-design, design-system, ux-copy, accessibility-review, testing, code-review, and any
others that fit). At the end, say which skills you used, or that none fit. If a skill or tool you
need is missing, stop and tell me exactly what to install.

Task UNI-1: the sales invoice form still uses the old lines table (native <select> in every
cell, fixed-height boxes, see audit finding FORM-01 in docs/ui-system/audit.md and the
screenshot Del sent: "Barkod oxut" box, then rows with product search, warehouse select,
quantity box, unit select, price + price type + currency selects). Every other document form
already uses the one line editor LineGrid (src/components/line-grid, UI-3 PR #85; purchases use
it via src/modules/purchases/components/PurchaseLinesGrid.tsx). Move the sales form lines to
LineGrid so sales look and behave exactly like purchases.

Follow CLAUDE.md "SaaS program rules" and docs/ui-standard.md (Line grids section, FORM rules).
Branch: saas/sales-line-grid from the latest main. Draft PR.
Flag: show the new grid only when UI_UNIFIED is on for the user (today admins only in
production, see src/lib/features/uiUnified.ts and how other UI-7 work reads it). Everyone else
keeps the old table unchanged. Del tests as admin first; UNI-1b (below) switches it on for all.

Scope:
- src/modules/sales/components/InvoiceForm.tsx (about 3,300 lines). Extract the lines part into
  src/modules/sales/components/SalesLinesGrid.tsx the same way PurchaseLinesGrid.tsx is built
  (columns array of LineColumn, cells from line-grid/cells.tsx, EntityLookup for the product
  with quick-create, Combobox instead of native selects, money/number inputs with the locale
  format). Business logic (prices by price type, currency and rate per line, discounts, VAT,
  stock warnings per line from PR #12, cut-piece modal for dimensional products, product
  selector modal, INV-1 "New product" button, barcode scan adding a line) stays in the form and
  must work exactly as before in both grids. Do not change how a sale is saved or posted.
- Main columns visible by default: product, quantity, unit, price, discount, line total.
  Warehouse, price type, currency, VAT, notes and the other per-line fields become optional
  columns (Columns button) and are always editable in the details drawer, as LineGrid does.
  If the invoice has only one warehouse in use, the warehouse column stays hidden by default.
- Barcode: keep BarcodeScanField above the grid (as the purchase form does) and the scan must
  add or increase a line in the new grid.
- Lines are added from the "+ Add line" row at the bottom and Ctrl+Enter, like every LineGrid.
- Totals stick to the bottom of the grid (LineGrid footer), not a separate box.
- Keyboard: Tab/Enter move as in the purchase grid; no focus loss when a line is added.
- While here, in the same flag branch only: the header fields of the sale form that are native
  <select>/<input type=date> become Combobox / DateField / EntityLookup (customer with
  quick-create), and the "please choose a customer" warning shows only after Save is pressed
  (FORM-03). Nothing else of the form changes.
- Do not touch the polywood sale form or other forms (UNI-2 does).

Check in the browser (Del's rule: never leave the form to create a related record): new sale,
add 5 lines by search, by barcode, by product selector, with a cut piece, with a foreign
currency line, with a discount, with a new product made from the grid; save as draft, open
again, post; edit a draft. Compare totals with the old grid for the same invoice (write a small
test that feeds the same lines to both total functions). Screenshots at 1366 and 1280 width and
on a phone, before/after, in the PR.

Tests: unit tests for any new pure helpers (line to grid row mapping, totals), and a check that
with UI_UNIFIED off the old table renders.

Before the PR: npm run lint, npm test, npm run build. PR text in plain words, rule ids touched
(FORM-x, A11Y-x, GRID rules), screenshots, manual step: none (flag already set; admins see it).

UNI-1b (only after Del says the new sales grid is fine; a tiny separate PR on branch
saas/sales-line-grid-all): show SalesLinesGrid for every user under UI_STANDARD (on in
production) like PurchaseLinesGrid, and delete the old table code from InvoiceForm.tsx.

----

## UNI-2: بقیه فرم‌هایی که جدول سطر قدیمی دارند

----
Before starting, check the list of available skills. Use every skill that fits this task
(frontend-design, design-system, accessibility-review, testing, code-review, and any others that
fit). At the end, say which skills you used, or that none fit. If a skill or tool you need is
missing, stop and tell me exactly what to install.

Task UNI-2: after UNI-1, no form in the app may edit document lines with an old hand-made table.
Follow CLAUDE.md "SaaS program rules" and docs/ui-standard.md. Branch: saas/line-grid-rest from
the latest main (with UNI-1 merged). Draft PR. Same flag rule as UNI-1 (new grid under UI_UNIFIED
for admins first, old one for everyone else).

Step 1, inventory (write it in the PR before changing code): list every screen where the user
enters or edits lines of a document (products, services, costs, materials, counted quantities)
and say for each: uses LineGrid already / old table. Search for "<table" together with inputs or
selects in src/modules and src/app, and open each screen on the live site in Chrome (look only,
change nothing). Known candidates:
- src/modules/polywood/components/MixedDimensionalInvoiceForm.tsx (polywood sale lines)
- src/modules/inventory/components/InventoryCountDetailPage.tsx (counted lines)
- src/modules/production/components/ProductionInProgressPhase.tsx (three tables)
- src/modules/crm/components/QuotationBuilderModal.tsx (check whether the <table> left there is
  still a line editor)
- every consignment screen reachable from the menu (dispatch, settlement, initial balance,
  return); Del believes some consignment buy/sell form is still old: find which one and say it.
- src/modules/consignment/components/ConsignmentInvoiceForm.tsx looks unused (no import found):
  confirm with a search and delete it if nothing uses it.
Read-only tables (views, reports, print) are not part of this task.

Step 2: move each line editor found to LineGrid with the same column rules as UNI-1 (main
columns visible, rare ones optional + drawer, add-line row, sticky totals, lookups with
quick-create). One commit per screen. Business logic unchanged. If a screen is too special for
LineGrid (for example a count sheet that is really a checklist), stop on that one, explain why
in the PR and propose what to do; do not force it.

Check each screen in the browser as in UNI-1, before/after screenshots in the PR. Tests for any
pure helper. lint, test, build before the PR. PR text with the inventory table, rule ids,
screenshots, and the follow-up "switch to everyone" step (like UNI-1b) for Del.

----

## TPL-1: مدل قالب سند، جدول دیتابیس، موتور سه خروجی (بدون صفحه)

----
Before starting, check the list of available skills. Use every skill that fits this task
(xlsx, pdf, architecture, system-design, testing, code-review, and any others that fit). At the
end, say which skills you used, or that none fit. If a skill or tool you need is missing, stop
and tell me exactly what to install.

Task TPL-1: the core of a document template ("Faktura dizaynı") system. One template describes
the layout of a printed document; the SAME template drives three outputs: the HTML print, the
PDF (pdfmake) and the Excel file (ExcelJS writer from XLS-1). This PR has no designer page (TPL-2)
and does not switch print/PDF/Excel to templates yet (TPL-3). Nothing visible changes.
Odoo has report layouts; use it only as a concept reference (rule 9).

Follow CLAUDE.md "SaaS program rules". Branch: saas/doc-templates-core from the latest main
(XLS-1 merged). Draft PR. New flag INVOICE_DESIGNER (server-only, off by default), made the same
way as src/lib/features/invoiceTools.ts, passed to the client the same way.

1. Template model (src/lib/doc-templates/, pure TypeScript, no React, no Supabase):
   - `DocTemplateLayout` (with `schemaVersion: 1`):
     - page: size "A4" | "A5" | "Letter", orientation, margins in mm, base font size (8–12),
       accent colour (hex), show watermark for draft/cancelled (bool).
     - sections: ordered list; a section is a row with 1 to 3 columns (width as fractions of 12);
       each column holds an ordered list of blocks. Optional `repeatOnEveryPage` for a header
       section and a footer section (PDF/print only; Excel uses the print header/footer).
   - Block types (each with an id, a type, and its own options; texts typed by the user are
     stored per language {az, en, ru} with fallback az → en → ru):
     companyHeader (logo on/off and size, which company fields), title (auto by document type
     or custom text), docFields (which document fields, in which order, 1 or 2 columns),
     party (customer/supplier fields), linesTable (columns: key, custom header text, width,
     visible, alignment; zebra rows; header fill on/off; font size), totals (which rows,
     emphasise grand total), payments, notes, bankDetails (from company profile), signatures
     (1–3 slots with label text, optional seal image from company_profile.seal_url),
     text (plain text with placeholders like {{docNo}} {{docDate}} {{partyName}} {{grandTotal}};
     plain text only, never HTML), image (company logo or seal only; no external URLs),
     divider, spacer (height), amountInWords (added in TPL-4; reserve the type name).
   - Field and column keys are a fixed catalogue per document type (sale, purchase first) built
     from InvoiceExportDoc (src/lib/export/invoiceExport.ts); a template can only reference keys
     from the catalogue.
   - `validateDocTemplate(json): { ok, layout, errors }`: hand-written validator (do not add a
     schema library unless one is already in package.json). Rejects unknown block types, unknown
     keys, bad colours, too many sections/blocks (limits as constants), text over 2,000 chars,
     image sources that are not "logo" or "seal". Unknown future fields are dropped, not fatal.
   - `migrateDocTemplate` stub that upgrades older schemaVersion values (only v1 now).
2. System templates: express TODAY's layouts as templates (sale official, sale unofficial,
   purchase), as constants in code, so the template renderers can produce the same documents as
   now. Tests compare: for the sample docs, the template PDF definition equals (or differs only
   in documented, harmless ways from) buildInvoicePdfDefinition; the template workbook has the
   same cells/values as the XLS-1 writer. These system templates are the fallback whenever no
   custom default exists.
3. Renderers (pure, tested in Node):
   - `renderTemplatePdf(layout, doc, labels, options)` → pdfmake definition (sections become
     pdfmake columns; linesTable a table with headerRows: 1 so it repeats on new pages).
   - `renderTemplateWorkbook(ExcelJS, layout, doc, labels, options)` → Workbook. Mapping rule:
     the sheet grid has as many columns as the visible linesTable columns (min 6); a section
     column of width w/12 spans the matching share of grid columns (merged cells); blocks stack
     down; styles (fills, borders, number formats, fonts, logo/seal images) follow the layout.
     Document the mapping in a comment at the top of the file.
   - `renderTemplateHtml` → a React-free description (array of nodes) that TPL-3 turns into the
     print component; or a React component in src/components/doc-templates/ if that is cleaner,
     but the layout → node logic must stay pure and tested.
   - Placeholders resolved by one function with escaping; amounts and dates formatted with the
     user's locale like the PDF.
4. Database: one migration supabase/migrations/20261125100000_document_templates.sql (check
   `ls supabase/migrations` and open PRs first; if the prefix is taken pick the next free one
   and say so):
   - table public.document_templates: id uuid pk default gen_random_uuid(), doc_type text not null
     (check in ('sale','purchase','consignment_dispatch','consignment_settlement','quotation',
     'stock_transfer','damaged_goods','purchase_return','sale_return')), variant text not null
     default 'default' (check in ('default','official','unofficial')), name text not null
     (1–80 chars), layout jsonb not null, schema_version int not null default 1,
     is_default boolean not null default false, archived_at timestamptz, created_by uuid
     references auth.users, updated_by uuid, created_at / updated_at timestamptz default now().
   - unique partial index: one default per (doc_type, variant) where is_default and archived_at
     is null. Check constraint on pg_column_size(layout) (e.g. under 256 KB).
   - RLS on: select for authenticated users (everyone who can print needs the template);
     insert/update/delete only for admins (use public.is_admin(), already in the schema; check
     its signature). updated_at trigger like other tables. A SECURITY DEFINER function
     set_default_document_template(p_id uuid) that clears the old default and sets the new one in
     one transaction (admin check inside, search_path set).
   - No seed rows: system templates live in code. Each SaaS tenant has its own database, so no
     tenant column (confirm against docs/SaaS-Commercialization-Plan.md).
   - Test the migration on the local/dev database only (rule 4). In the PR, the exact SQL file to
     run in production and the order.
5. Data access: src/lib/doc-templates/repo.ts with list/get/getDefault(docType, variant)/save
   (validate before write)/duplicate/archive/setDefault, using the existing Supabase client
   helpers. getDefault falls back to the system template when none or when validation fails
   (log a warning; printing must never break because of a bad template).

Tests: validator (good and bad inputs), placeholders (escaping, missing values), PDF and Excel
renderers against the system templates, mapping of a 3-column section to merged Excel cells,
a long invoice (60 lines) in PDF keeps the table header on page 2.

Before the PR: npm run lint, npm test, npm run build. PR text: what changed in plain words, the
template JSON shape with one example, the SQL to run, how it was tested, flag stays off.

----

## TPL-2: صفحه «Faktura dizaynı» با کشیدن و رها کردن

----
Before starting, check the list of available skills. Use every skill that fits this task
(frontend-design, design-system, ux-copy, accessibility-review, design-critique, testing,
code-review, and any others that fit). At the end, say which skills you used, or that none fit.
If a skill or tool you need is missing, stop and tell me exactly what to install.

Task TPL-2: the designer page where an admin builds document templates by drag and drop, on the
TPL-1 model. Follow CLAUDE.md "SaaS program rules", docs/ui-standard.md and the design tokens.
Branch: saas/doc-templates-designer from the latest main (TPL-1 merged, SQL run). Draft PR.
Behind INVOICE_DESIGNER and admin-only (server check + RLS); with the flag off the page and its
menu entry do not exist. Odoo is only a concept reference (rule 9). Visual references for the
drag behaviour: docs/ui-library/vibeprompts/dashboards/dashboards-kanban-board-with-drag-and-drop
and docs/ui-library/vibeprompts/bonus/bonus-drag-to-reorder-priority-stack (rebuild, never paste
their JS).

Where: Settings → a new item "Faktura dizaynı" (az) / "Invoice design" (en) / "Дизайн счетов"
(ru) in the settings menu (src/lib/settings/items, the group that has Company), route
/settings/document-templates. All texts through src/i18n in az, en, ru.

Page 1, list: templates grouped by document type (Sale official, Sale regular, Purchase; later
types appear when TPL-4 adds them), each with name, "Default" badge, updated by/at, row menu
(Edit, Duplicate, Set as default, Archive). The system template shows as "System (built-in)",
can be duplicated and previewed but not edited. "New template" asks for document type and
starts from a copy of the system template of that type.

Page 2, editor (full width, three panes, works from 1280 px; below 1024 px show a notice that
the designer needs a wider screen, the list still works):
- Left pane "Blocks": the block types from TPL-1 with icon and short help; drag one onto the
  page, or click it to add at the end / into the selected column.
- Centre: the page at real proportions (A4/A5, orientation), rendered with the same template
  → HTML renderer TPL-3 will use (build it here as a preview component if TPL-1 did not), with
  sample data or a real document (a "Preview with" lookup to pick any sale or purchase;
  EntityLookup). Sections show as rows with a dashed outline on hover; a section toolbar to set
  1/2/3 columns and widths (presets 12, 6+6, 8+4, 4+8, 4+4+4), move up/down, duplicate, delete.
  Blocks can be dragged within a column, to another column and to another section; drop
  indicators show where they land; an "Add section" row at the bottom.
- Right pane "Properties" of the selected block / section / page: the options from the model
  (checkbox lists with drag handles to order fields and table columns, width inputs, alignment,
  colour picker limited to a palette plus hex, font size, texts in az/en/ru tabs with the
  placeholder list to insert, on/off switches). Page settings when nothing is selected.
- Top bar: template name (inline edit), document type (read-only), Undo / Redo (Ctrl+Z,
  Ctrl+Shift+Z, at least 50 steps), "Download test PDF", "Download test Excel", "Print test",
  Save (sticky save bar per FORM-5, unsaved-changes guard), "Set as default", "Reset to
  system". Save validates with validateDocTemplate and shows errors next to the block.
- Drag and drop library: motion's Reorder (already used) cannot move items between lists, so use
  @dnd-kit/core + @dnd-kit/sortable (MIT, pin exact versions) with the keyboard sensor so every
  move can be done without a mouse (A11Y). Announce moves for screen readers. Respect reduced
  motion. Note this new dependency and why in the PR as the rule-10 exception.
- State: one reducer (pure, tested) for all edits: add/move/remove/duplicate block, section
  edits, option changes, undo/redo history. The UI only dispatches.

Tests: reducer (every action, undo/redo, moving across sections), properties → layout mapping,
the page is not reachable with the flag off or for a non-admin, and a Playwright smoke test if
the repo has e2e set up (build a template: add a text block, move the totals block to the right
column, save, reload, it is still there).

Check in the browser at 1366 and 1280 width (dark and light). Screenshots of list and editor in
the PR, plus a short screen recording (gif) of a drag if possible.

Before the PR: npm run lint, npm test, npm run build. PR text in plain words, rule ids touched,
screenshots, manual step: set INVOICE_DESIGNER=true in production env and restart (commands for
Del in separate copy-paste code blocks).

----

## TPL-3: چاپ، PDF و اکسل از روی قالب پیش‌فرض

----
Before starting, check the list of available skills. Use every skill that fits this task
(xlsx, pdf, frontend-design, testing, code-review, and any others that fit). At the end, say
which skills you used, or that none fit. If a skill or tool you need is missing, stop and tell
me exactly what to install.

Task TPL-3: when INVOICE_DESIGNER is on, the sale and purchase print, the PDF download and the
Excel download all use the default template of that document type (and variant
official/unofficial for sales), falling back to the system template. With the flag off, the
current code paths run unchanged.

Follow CLAUDE.md "SaaS program rules". Branch: saas/doc-templates-wiring from the latest main
(TPL-2 merged). Draft PR.

- Print: InvoicePrintSystem / PrintInvoiceModal / InvoicePrintLayout and PurchasePrintTemplate:
  under the flag render the template HTML renderer instead of the fixed layout. Print CSS: page
  size and margins from the template (@page), table header repeats (thead), no app chrome.
- PDF and Excel: useInvoiceExport / invoiceExportDownload.ts call renderTemplatePdf /
  renderTemplateWorkbook with the default template (fetched once per session, cached, refreshed
  after a template is saved).
- Template choice: if a document type has more than one non-archived template, the print/export
  dialog (the same PrintInvoiceModal question) gets a "Template" select with the default
  preselected; one template = no extra question. Remember the last choice per user in
  localStorage (safe try/catch).
- Official/unofficial: the existing question decides the variant; official-only invoices skip it
  as today.
- Never break printing: any error in a custom template → print with the system template and a
  toast "Template has an error, printed with the standard layout" (i18n), and log the error.

Tests: the choice logic (which template for which doc/variant, fallback on invalid layout), and
that with the flag off the old functions are called. Check in the browser: make a custom
template in the designer (logo bigger, totals on the left, extra text "Bank: …", signatures),
set default, then print, PDF and Excel for a sale and a purchase; all three must show the same
layout. Screenshots of the three outputs in the PR.

Before the PR: npm run lint, npm test, npm run build. PR text in plain words, how tested, no SQL.

----

## TPL-4: سندهای دیگر، مهر و امضا، مبلغ به حروف

----
Before starting, check the list of available skills. Use every skill that fits this task
(xlsx, pdf, frontend-design, testing, code-review, and any others that fit). At the end, say
which skills you used, or that none fit. If a skill or tool you need is missing, stop and tell
me exactly what to install.

Task TPL-4: extend the template system beyond sale and purchase invoices.
Follow CLAUDE.md "SaaS program rules". Branch: saas/doc-templates-more-docs from the latest main
(TPL-3 merged). Draft PR. Behind INVOICE_DESIGNER.

1. More document types, one commit each, each with a field/column catalogue, a system template
   equal to today's print, and Print / PDF / Excel through the template: consignment dispatch
   (ConsignmentDeliveryPrintTemplate), consignment settlement (ConsignmentSettlementPrintTemplate),
   quotation (QuotationPrintTemplate), stock transfer (StockTransferPrintTemplate), damaged
   goods (DamagedGoodsPrintTemplate), and sale/purchase returns if they have a print. Where a
   document has no PDF/Excel download today, add "Download PDF" / "Download Excel" next to its
   Print (same pattern as INV-2). Contracts and production job cards are NOT in this task.
2. Seal and signature: the signatures block can show the company seal (company_profile.seal_url)
   and a signature image per slot. If signature images need storage, use the same bucket and
   admin-only rules as the logo/seal; add a column or table only if needed, in one migration
   20261125110000_document_template_assets.sql (check the prefix is free).
3. amountInWords block: the grand total in words in the document language (az first: e.g.
   "Yüz iyirmi beş manat 40 qəpik"; en and ru too), currency names per currency code, pure
   function with tests for 0, 1, 11, 100, 1,000, 1,000,000, decimals, negative not allowed.
4. Designer: the new types appear in the list and "New template"; the placeholder list per type.

Tests for each catalogue and system template, amount in words, and a browser check of each new
document's print/PDF/Excel. lint, test, build before the PR. PR text with screenshots per
document type, the SQL (if any) and its order.

----
