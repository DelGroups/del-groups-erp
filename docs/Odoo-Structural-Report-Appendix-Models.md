# ضمیمه ب: مدل‌های کلیدی Odoo (فیلد، وضعیت، رابطه، دکمه)

> منبع: دیتابیس آزمایشی Odoo 20.0+e، 2026-10-11، از `fields_get` و form view هر مدل (متادیتا، نه کد).
> «فیلد» = همه فیلدها / ذخیره‌شده در دیتابیس. «Mixin»: chatter، activities، multi-company، analytic، website، custom-fields (فیلد Studio).
> «Header» = دکمه‌های اقدام بالای فرم (بسته به وضعیت فقط بعضی دیده می‌شوند). «Smart» = دکمه‌های هوشمند (اسناد مرتبط).
> بازگشت به [گزارش اصلی](Odoo-Structural-Report.md).

## هسته

### `res.partner` (طرف‌حساب)
- فیلد: 312 / 162 · Mixin: chatter, activities, multi-company, website
- رابطه: `parent_id` (شرکت مادر)، `child_ids` (اشخاص و آدرس‌ها)، `commercial_partner_id`، `user_id` (فروشنده)، کشور/استان/شهر، صنعت، `property_account_receivable_id` / `property_account_payable_id`، `property_payment_term_id` (فروش) و `property_supplier_payment_term_id` (خرید)، `property_account_position_id` (fiscal position)، `specific_property_product_pricelist`، `bank_ids`
- Smart: فرصت‌ها، سفارش فروش، سفارش POS، فاکتورها، گزارش پیگیری بدهی، اشتراک‌ها، رویدادها، جلسات، کارها

### `res.company`
- فیلد: 379 / 303 · Mixin: chatter
- نکته: تنظیمات همه اپ‌ها روی خود شرکت ذخیره می‌شود (سال مالی، روش قیمت تمام‌شده، سیاست تحویل، قانون فاکتور فروش، دوره اظهارنامه، حساب‌های پیش‌فرض، layout گزارش، تقویم کاری). `parent_id` / `child_ids` برای شعبه‌ها.

### `res.users`
- فیلد: 495 / 77 · وضعیت: new / active / inactive
- رابطه: `partner_id` (هر کاربر یک طرف‌حساب دارد)، تیم فروش، انبار پیش‌فرض، کلید API، دستگاه، جلسه، 2FA/passkey

### `mail.activity` (فعالیت)
- فیلد: 43 / 31 · وضعیت: overdue / today / planned / done · الزامی: `date_deadline`
- رابطه: `res_model_id` + `res_id` (هر رکوردی)، `activity_type_id`، `user_id`، رویداد تقویم، درخواست امضا، درخواست سند
- انواع در این دیتابیس (18): To-Do، Email، Call، Meeting، Upload document، Signature request، Expense/Time off/Allocation approval، Contract to renew، Maintenance request و …

## فروش و CRM

### `crm.lead`
- فیلد: 134 / 80 · Mixin: chatter, activities, multi-company · الزامی: `name`, `type` (lead/opportunity)
- وضعیت: `stage_id` → `crm.stage`، `priority` 0–3، probability، `lost_reason_id`، active (باخت = آرشیو)
- رابطه: تیم، فروشنده، طرف‌حساب، UTM (campaign/source/medium)، recurring plan، رویداد، `order_ids` (پیش‌فاکتورها)، جلسات تقویم، پروژه‌ها
- Header: New Quotation، New Rental، Won، Convert to Opportunity، Enrich، Lost، Restore، Convert to Ticket

### `sale.order`
- فیلد: 257 / 121 · Mixin: chatter, activities, multi-company, custom-fields
- الزامی: `partner_id`, `partner_invoice_id`, `partner_shipping_id`, `date_order`, `picking_policy`
- وضعیت: `state` draft → sent → sale → cancel · `invoice_status` no / to invoice / invoiced / upselling
- رابطه: pricelist، شرط پرداخت، fiscal position، تیم، فروشنده، incoterm، حساب تحلیلی، حامل، `opportunity_id`، `order_line`، `picking_ids`، فاکتورها، تعمیر، هزینه، اشتراک فرزند
- Header: Send، Confirm، Preview، Create Invoice، Ship، Pickup/Return (اجاره)، Capture/Void Transaction، Unlock، Cancel · Statusbar: draft, sent, sale
- Smart: پروژه، timesheet، planning، تحویل، فاکتور، تعمیر، POS

### `sale.order.line`
- فیلد: 176 / 96 · Mixin: multi-company, analytic · الزامی: `order_id`, `product_uom_qty`, `price_unit`
- رابطه: محصول، واحد، انبار، `move_ids` (حرکت انبار)، `purchase_line_ids`، پروژه/کار، رویداد/بلیت، هزینه، planning، سطر تحلیلی، milestone
- نکته: ستون‌های qty_delivered و qty_invoiced روی خود سطر

## خرید

### `purchase.order`
- فیلد: 100 / 50 · Mixin: chatter, activities, multi-company
- وضعیت: draft (RFQ) → sent → to approve → purchase → cancel · `invoice_status` · priority
- رابطه: تأمین‌کننده، آدرس تحویل مستقیم، fiscal position، شرط پرداخت، incoterm، پروژه، `picking_type_id`، `order_line`
- Header: Send RFQ، Confirm Order، Approve Order، Receive، Send PO، Acknowledge، Print، Lock/Unlock، Set to Draft، Cancel
- Smart: تطبیق قبض، قبض‌ها، رسیدها، تولید مرتبط، فروش مرتبط، مقایسه پیشنهادها، نرخ کیفیت

## انبار

### `stock.picking` (رسید / حواله / انتقال)
- فیلد: 126 / 54 · Mixin: chatter, activities, multi-company · الزامی: `picking_type_id`, `location_id`, `location_dest_id`
- وضعیت: draft → waiting → confirmed → assigned → done / cancel
- رابطه: backorder، return، batch، سفارش فروش، POS، پروژه، حامل، دلیل بازگشت، `move_ids`, `move_line_ids`، کنترل کیفیت
- Header: Mark as To Do، Reserve، Validate، Print، Return، Exchange، Quality Checks/Alert، Lock/Unlock، Send to Shipper، Cancel

### `stock.move` / `stock.move.line`
- `stock.move`: 130 / 83 · الزامی: product, qty, uom, `location_id`, `location_dest_id`, `procure_method` · وضعیت: draft → waiting → confirmed → partially_available → assigned → done / cancel
- رابطه: picking، rule، orderpoint، تولید (`production_id` برای محصول، `raw_material_production_id` برای مواد)، سطر فاکتور، ارزش‌گذاری (`product_value_ids`)، کنترل کیفیت
- `stock.move.line`: سطر اجرایی با lot، package و مقدار انجام‌شده

### `stock.quant` (موجودی)
- 43 / 21 · کلید: product + location + lot + package + owner · `reserved_quantity`

### `stock.location`
- 35 / 27 · درختی (`location_id`, `child_ids`) · `usage`: view / internal / supplier / customer / inventory / production / transit · removal strategy، storage category، حساب ارزش‌گذاری

### `stock.warehouse`
- 52 / 49 · `reception_steps`, `delivery_steps`, `manufacture_steps` · برای هر انبار location‌های ورودی، کنترل کیفیت، خروجی، بسته‌بندی و نوع عملیات و route خودکار ساخته می‌شود

### `stock.rule`
- 28 / 24 · `action` (pull / push / pull_push / buy / manufacture) · `procure_method` (make_to_stock / make_to_order / mts_else_mto) · route، location مبدأ و مقصد، نوع عملیات

## تولید

### `mrp.bom`
- 67 / 35 · Mixin: chatter, activities · `type` (normal / phantom=kit) · `bom_line_ids`, `byproduct_ids`, `operation_ids` (مسیر روی مرکز کار), `eco_ids`

### `mrp.production` (سفارش تولید)
- 147 / 62 · Mixin: chatter, activities, multi-company
- وضعیت: draft → confirmed → progress → to_close → done / cancel
- رابطه: محصول، BoM، location مواد و محصول، `move_raw_ids` (مصرف)، `move_finished_ids` (تولید)، `workorder_ids`، orderpoint، سطر فروش، پروژه، unbuild، ECO
- Header: Confirm، Start، Produce، Quality Checks/Alert، Set to In Progress، Reset to Draft، Cancel
- Smart: گزارش تخصیص، خرید مرتبط، فروش مرتبط، MO فرزند و مبدأ، backorder، unbuild، اسکرپ

### `mrp.workorder`
- 120 / 48 · وضعیت: blocked → ready → progress → done / cancel · مرکز کار، عملیات، ثبت زمان (`time_ids`)، کنترل کیفیت

### `mrp.eco` (تغییر مهندسی، PLM)
- 74 / 36 · وضعیت: confirmed → progress → rebase / conflict → done + stage · BoM جاری و جدید، تغییرات BoM و مسیر، تأییدها
- Header: Start Revision، Approve، Reject، Apply Changes، Apply Rebase

## حسابداری

### `account.move` (فاکتور، قبض، اعتبار، سند)
- فیلد: 285 / 141 · Mixin: chatter, activities, multi-company
- `move_type`: entry / out_invoice / out_refund / in_invoice / in_refund / out_receipt / in_receipt
- وضعیت: draft → posted → cancel · `payment_state`: not_paid / partial / in_payment / paid / reversed / blocked
- رابطه: دفتر، طرف‌حساب، آدرس تحویل، حساب بانکی، شرط پرداخت، fiscal position، `line_ids` (همه سطرها)، `invoice_line_ids` (سطرهای محصول)، پرداخت‌ها، سند معکوس، audit trail
- Header: Post/Confirm، Send، Print، Pay، Preview، Reverse Entry، Credit Note، Reset to Draft، Cancel، Lock

### `account.move.line`
- 152 / 84 · Mixin: analytic · حساب، طرف‌حساب، مالیات (`tax_ids`, `tax_line_id`, `tax_repartition_line_id`)، تطبیق (`matched_debit_ids`, `matched_credit_ids`, `full_reconcile_id`)، سطر بانک، خودرو

### `account.payment`
- 94 / 45 · وضعیت: draft → paid → reconciled / canceled / rejected · `payment_type` inbound/outbound، `partner_type` customer/supplier، حساب در جریان (`outstanding_account_id`)، انتقال داخلی جفتی

### `account.account` / `account.journal` / `account.tax`
- حساب: 92 / 39 · `account_type` (۱۹ نوع: دریافتنی، نقد، جاری، غیرجاری، پیش‌پرداخت، دارایی ثابت، پرداختنی، کارت اعتباری، بدهی جاری/غیرجاری، حقوق صاحبان سهام، سود انباشته، درآمد، درآمد دیگر، هزینه، هزینه دیگر، استهلاک، بهای تمام‌شده، خارج از ترازنامه)، `parent_id`، حساب‌های معوق و استهلاک، دسته مالی
- دفتر: 112 / 44 · `type` (sale / purchase / cash / bank / credit / general)، حساب پیش‌فرض، حساب معلق، روش‌های پرداخت ورودی/خروجی، اتصال بانک آنلاین، alias ایمیل برای دریافت قبض
- مالیات: 65 / 43 · `type_tax_use` (sale/purchase)، `amount_type` (percent/fixed/group/division)، گروه مالیاتی، سطرهای توزیع (repartition) برای فاکتور و اعتبار

### `account.analytic.line` (سطر تحلیلی و timesheet)
- 65 / 40 · حساب تحلیلی، حساب کل، سطر سند، پروژه، کار، کارمند، دپارتمان، سطر فروش، مرخصی · `validated_status`

## منابع انسانی

### `hr.employee`
- 320 / 113 · Mixin: chatter, activities, multi-company, analytic
- رابطه: `version_ids` / `current_version_id` (نسخه شرایط)، کاربر، work contact، مدیر (`parent_id`)، coach، محل کار برای هر روز هفته، پوشه Documents، خودروها، تجهیزات، متقاضی، رزومه، مهارت، ارزیابی
- Smart: اسناد، ارزیابی، اهداف، امضا، planning، فیش، مرخصی، timesheet

### `hr.version` (نسخه قرارداد/شرایط)
- 121 / 70 · `date_version` · دپارتمان، شغل، محل کار، برنامه کاری، نوع کارمند، ساختار حقوق، قالب قرارداد، خروج

### `hr.leave` / `hr.leave.allocation`
- مرخصی: 106 / 46 · وضعیت: confirm → validate1 → validate / refuse / cancel · نوع زمان، تأییدکننده اول و دوم، جلسه تقویم، timesheet
- تخصیص: 67 / 30 · همان وضعیت‌ها · accrual plan

### `hr.attendance`
- 59 / 35 · وضعیت: draft → validated / refused · check_in، check_out، worked_hours، قانون زمانی، سطرهای اضافه‌کار

### `hr.expense`
- 110 / 59 · وضعیت: draft → submitted → approved → posted → in_payment → paid / refused · `payment_mode` (own_account / company_account / payslip_account)
- Header: Submit، Approve، Refuse، Split، Digitize document، Reset

### `hr.payslip`
- 122 / 61 · وضعیت: draft → validated → paid / cancel · ساختار، نسخه کارمند، pay run، سند حسابداری، `line_ids`، `worked_days_line_ids`، `input_line_ids`، هزینه‌ها
- Header: Compute، Validate، Pay، Correct، Print، Send by Email، Cancel

### `hr.applicant` / `hr.appraisal`
- متقاضی: 132 / 75 · stage + kanban_state + priority · شغل، دپارتمان، استخدام‌کننده، UTM، talent pool، مهارت، جلسات · Header: Create Employee، Refuse، Add to Pool
- ارزیابی: 75 / 30 · 1_new → 2_pending → 3_done · قالب، مقیاس ارزیابی، مهارت، هدف

## خدمات و بهره‌وری

### `project.project` / `project.task`
- پروژه: 151 / 52 · حساب تحلیلی، مشتری، مدیر، سطر فروش، lead، پوشه Documents، milestone، collaborator، update (گزارش وضعیت)
- کار: 160 / 65 · `state`: 01_in_progress / 02_changes_requested / 03_approved / 04_waiting_normal / 1_done / 1_canceled + `stage_id` + priority · `parent_id` (زیرکار)، milestone، تکرار، سفارش فروش، رویداد تقویم، timesheetها · بدون `project_id` = To-do شخصی با `personal_stage_type_id`

### `calendar.event`
- 132 / 55 · الزامی: `name`, `start`, `stop`, `show_as` · `res_model` + `res_id` (اتصال به هر رکورد)، تکرار، شرکت‌کننده‌ها (`attendee_ids`)، کانال تماس تصویری، نوع قرار، فرصت، متقاضی
- Header: Send email، Confirm، Check in، No show، Cancel، Create Order

### `documents.document`
- 128 / 67 · `type` (folder / binary / url / request) · پوشه (`folder_id`)، مالک، طرف‌حساب، قفل، دسترسی (`access_ids`, `access_internal`, `access_via_link`)، میانبر، درخواست سند (activity)، spreadsheet، embedding برای AI

### `approval.request`
- 74 / 30 · `request_status`: new → pending → approved / refused · دسته، مالک درخواست، `approver_ids`، سطرهای محصول (برای ساخت RFQ)
- Header: Submit، Approve، Refuse، Withdraw، Back To Draft، Create RFQ's، Cancel

### `helpdesk.ticket`
- 122 / 55 · stage + kanban_state + priority · تیم، مسئول، مشتری، UTM، `sla_status_ids`، سفارش فروش، کانال گفتگو · Smart: تیکت‌های مشابه، رتبه، مداخله‌ها

### `planning.slot`
- 142 / 48 · 1_draft → 2_published → 3_in_progress → 4_completed · نقش، قالب، تکرار، تیکت، سطر فروش

### `knowledge.article`
- 107 / 58 · درختی (`parent_id`, `root_article_id`)، مجوز ارثی، عضو، علاقه‌مندی، stage، قالب

### `sign.request`
- 75 / 40 · shared → scheduled → sent → signed / canceled / expired · قالب، امضاکننده‌ها، لاگ

## زنجیره تأمین پیرامونی

### `quality.check`
- 97 / 46 · نقطه کنترل، نوع تست، picking، workorder، تولید، lot، spreadsheet · Header: Pass، Fail، Measure، Create Alert

### `maintenance.request`
- 63 / 41 · stage + state (normal / changes_requested / approved / done / cancelled) + priority · تجهیزات، تیم، مرکز کار، تولید

### `repair.order`
- 86 / 43 · draft → confirmed → done / cancel · محصول، lot، locationهای قطعه و بازیافت، سفارش فروش، `move_ids`، فاکتور · Header: Confirm Repair، End Repair، Quote، Invoice

### `fleet.vehicle`
- 109 / 65 · `state_id` · مدل، برند، راننده (partner و employee)، قراردادها، سرویس‌ها، کیلومتر، تجهیزات

### `pos.order`
- 94 / 60 · draft → paid → done / cancel · جلسه، پیکربندی، کارمند، سطرها، پرداخت‌ها، فاکتور، حواله
