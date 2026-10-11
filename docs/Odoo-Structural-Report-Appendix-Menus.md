# ضمیمه الف: ساختار منوی همه اپ‌های Odoo

> منبع: دیتابیس آزمایشی Odoo 20.0+e، 2026-10-11. برگرفته از متادیتای منو و action (نه کد).
> قالب هر سطر: `نام منو` → `مدل فنی` و نوع viewها به ترتیب پیش‌فرض. `(client)` یعنی صفحه سفارشی جاوااسکریپتی، `(server)` یعنی منو یک server action را اجرا می‌کند.
> بازگشت به [گزارش اصلی](Odoo-Structural-Report.md).


## Discuss

- Channels `discuss.channel` kanban/list/form
- Call History `discuss.call.history` list/form
- Configuration
  - Categories `discuss.category` list/form/kanban
  - Canned Responses `mail.canned.response` list/form/kanban
  - Roles `res.role` list/form
  - User Settings: Notifications, Voice & Video (client)

## Meeting Rooms

- Bookings `room.booking` gantt/calendar/list/kanban/form
- Rooms `room.room` kanban/list/form

## Calendar

- Calendar `calendar.event` calendar/list/form/activity
- Appointments `appointment.type` kanban/list/form
- Reporting `calendar.event` pivot/graph/calendar/list/form
- Configuration
  - Calendars `calendar.calendar` list/form
  - Work Locations `hr.work.location` list/form
  - Reminders `calendar.alarm` kanban/list/form
  - Tags `calendar.event.type` list/form

## Appointments

- Appointments `appointment.type` kanban/list/form
- Shared Links `appointment.invite` list
- Schedule: Resources, Staff (server)
- Reporting
  - Bookings `calendar.event` pivot/graph/calendar/list/form
  - Answers `appointment.answer.input` list/graph/pivot/form
  - Ratings `rating.rating` kanban/list/pivot/graph/form
- Configuration
  - Questions `appointment.question` list/form
  - Reminders `calendar.alarm` kanban/list/form
  - Resources `appointment.resource` list/form
  - Closing Days `appointment.leave` list/form

## To-do

- To-do `project.task` kanban/form/list/calendar/activity

## Knowledge

- Home (server)
- Articles `knowledge.article` list/kanban/hierarchy/form
- Configuration
  - Members `knowledge.article.member` list/form
  - Favorites `knowledge.article.favorite` list/form
  - Trashed `knowledge.article` list/form/kanban
  - Stages `knowledge.article.stage` list/form

## Contacts

- Contacts `res.partner` list/kanban/form/hierarchy/activity
- Configuration
  - Contact Tags `res.partner.category` list/form
  - Industries `res.partner.industry` list/form
  - Bank Accounts `res.partner.bank` list/form
  - Localization
    - Countries `res.country`, Fed. States `res.country.state`, Cities `res.city`, Country Group `res.country.group` (list/form)

## CRM

- Sales
  - My Pipeline `crm.lead` kanban/list/graph/pivot/form/calendar/activity
  - My Activities `crm.lead` list/kanban/graph/pivot/calendar/form/activity
  - My Quotations `sale.order` list/kanban/form/calendar/pivot/graph/activity
  - Teams `crm.team` kanban/form
  - Customers `res.partner` list/kanban/form/activity
- Leads `crm.lead` list/kanban/graph/pivot/form/activity
- Import & Synchronize
- Reporting
  - Forecast `crm.lead` kanban/graph/pivot/list/form
  - Pipeline `crm.lead` graph/pivot/cohort/list/form
  - Leads `crm.lead` graph/pivot/list
  - Activities `crm.activity.report` graph/pivot/list
- Configuration
  - Settings `res.config.settings` form
  - Sales Teams `crm.team` list/kanban/form
  - Teams Members `crm.team.member` kanban/list/form
  - Activity Types `mail.activity.type` list/kanban/form
  - Activity Plans `mail.activity.plan` list/kanban/form
  - Recurring Plans `crm.recurring.plan` list
  - Stages `crm.stage` list/form
  - Tags `crm.tag` list/form
  - Lost Reasons `crm.lost.reason` list/form
  - Lead Mining Requests `crm.iap.lead.mining.request` list/form

## Sales

- Orders
  - Quotations `sale.order` list/kanban/form/calendar/pivot/graph/activity/map
  - Orders `sale.order` list/kanban/form/calendar/pivot/graph/activity/map
  - Services & Material `account.analytic.line` list
  - Customers `res.partner` list/kanban/form
- Products
  - Products `product.template` list/form
  - Attributes `product.attribute` list/form
  - Pricelists `product.pricelist` list/kanban/form
- Marketplaces
- Reporting
  - Sales / Salespersons / Products / Customers `sale.report` graph/pivot/list
- Configuration
  - Settings `res.config.settings` form
  - Teams `crm.team` list/kanban/form
  - Deliveries `delivery.carrier` list/form
  - Payments `payment.provider` kanban/list/form
  - Templates `sale.order.template` list/form
  - Headers/Footers `quotation.document` kanban/list/form
- (Studio test) TEST Company Vehicle `x_test_company_vehicle` kanban/list/form/gantt/pivot/graph + Stages `x_test_company_vehicle_stage` + Tags `x_test_company_vehicle_tag`

## Dashboards

- Dashboards (client)
- Configuration
  - Dashboards `spreadsheet.dashboard` list/form
  - Sections `spreadsheet.dashboard.group` list
  - Share links `spreadsheet.dashboard.share` list

## Subscriptions

- Subscriptions
  - Subscriptions `sale.order` list/kanban/form/pivot/graph/cohort/activity
  - Quotations `sale.order` (same views)
  - To Renew `sale.order` (same views)
  - Upsells `sale.order` (same views)
  - Customers `res.partner` list/kanban/form
- Products
  - Products `product.template` kanban/list/form/activity
  - Pricelists `product.pricelist` list/kanban/form
- Reporting
  - Subscriptions `sale.subscription.report` graph/list/pivot
  - Retention `sale.order` cohort
  - MRR Breakdown `sale.order.log.report` graph/list/pivot
  - MRR Timeline `sale.order.log.report` graph/list/pivot
- Configuration
  - Recurring Plans `sale.subscription.plan` list/form
  - Quotation Templates `sale.order.template` list/form
  - Close Reasons `sale.order.close.reason` list/form

## Rental

- Orders
  - Orders `sale.order` list/kanban/form/calendar/pivot/graph/activity
  - Customers `res.partner` list/kanban/form
- Schedule `sale.order.line` gantt
- Products: Products `product.template`, Attributes, Categories, Pricelists
- Reporting `sale.rental.report` graph/pivot
- Configuration: Settings, Quotation Templates, Headers/Footers

## Point of Sale

- Dashboard `pos.config` kanban/list/form
- Orders
  - Orders `pos.order` list/form/kanban/pivot
  - Sessions `pos.session` list/kanban/form
  - Payments `pos.payment` list/form
  - Preparation Display `pos.prep.display` kanban/list/form
  - Customers `res.partner` list/kanban/form
- Products
  - Products `product.template` kanban/list/form/activity
  - Combo Choices `product.combo` list/form
  - Pricelists `product.pricelist` list/kanban/form
- Reporting
  - Orders `report.pos.order` graph/pivot
  - Sales Details `pos.details.wizard` form
  - Session Report `pos.daily.sales.reports.wizard` form
  - Preparation Time `preparation.time.report` graph
- Configuration
  - Payment Methods `pos.payment.method` list/kanban/form
  - Presets `pos.preset` list/form
  - Printers `pos.printer` list/kanban/form
  - Coins/Bills `pos.bill` list/form
  - Note Models `pos.note` list
  - Preparation Stages `pos.prep.stage` list/form
  - PoS Product Categories `pos.category` list/kanban/form
  - Product Tags `product.tag` list/form
  - Taxes `account.tax` list/kanban/form

## AI

- Agents `ai.agent` kanban/list/form
- Configuration
  - Skills `ai.skill` list/kanban/form
  - Tools `ir.actions.server` list/form
  - Default Prompts `ai.composer` list/kanban/form

## Accounting

- Dashboard `account.journal` kanban/form
- Customers
  - Invoices `account.move` list/kanban/form/pivot/graph/activity
  - Credit Notes `account.move` list/kanban/form/pivot/graph/activity
  - Payments `account.payment` list/kanban/form/graph/activity
  - Products `product.template` list/form
  - Customers `res.partner` list/kanban/form
- Vendors
  - Bills `account.move` list/kanban/form/pivot/graph/activity
  - Refunds `account.move` list/kanban/form/pivot/graph/activity
  - Payments `account.payment` list/kanban/form/graph/activity
  - Products `product.template` list/form
  - Vendors `res.partner` list/kanban/form
- Accounting
  - Transactions
    - Journal Entries `account.move` list/kanban/form/pivot/graph/activity
    - Analytic Items `account.analytic.line` list/kanban/form/graph/pivot/grid
  - Assets & Liabilities
    - Assets `account.asset` list/form
    - Loans `account.loan` list/form
    - Fleet `fleet.vehicle` kanban/list/form/pivot/activity
  - Closing
    - Reconcile `account.move.line` list
    - Tax Returns (server)
    - Lock Dates `account.change.lock.date` form
    - Secure Entries `account.secure.entries.wizard` form
- Review
  - Control: Journal Items `account.move.line` list/pivot/graph/kanban; Audit Trail `mail.message` list; Journal Audit (client)
  - Audit: Working Files `account.return` kanban; Annual Report `audit.report` kanban/list
  - Inventory: Inventory Valuation (client)
  - Regularization Entries: Unrealized Currencies, Deferred Revenues, Deferred Expenses (client)
  - Purchases: Bills To Receive, Billed Not Received `purchase.order.line` list
  - Sales: Invoices To Be Issued, Invoiced Not Delivered `sale.order.line` list
- Reporting
  - Statement Reports: Balance Sheet, Profit and Loss, Cash Flow Statement, Depreciation Schedule (client)
  - Ledgers: Trial Balance, General Ledger (client)
  - Partner Reports: Partner Ledger, Customer Statement, Aged Receivable, Aged Payable (client)
  - Taxes & Fiscal: Tax Report, Fiscal Report (client)
  - Management
    - Invoice Analysis `account.invoice.report` graph/pivot
    - Cashflow Analysis `account.bank.statement.line` graph/pivot
    - Analytic Report `account.analytic.line` pivot/list/kanban/form/graph/grid
    - Executive Summary (client)
    - Loans Analysis `account.loan.line` list/form
- Configuration
  - Settings `res.config.settings` form
  - Online Payments `payment.provider` kanban/list/form
  - Accounting
    - Chart of Accounts `account.account` list/kanban/form
    - Taxes `account.tax` list/kanban/form
    - Journals `account.journal` list/kanban/form
    - Currencies `res.currency` list/kanban/form
    - Fiscal Positions `account.fiscal.position` list/kanban/form
    - Multi-Ledger `account.journal.group` list/form
    - Tax Groups `account.tax.group`, Tax Units `account.tax.unit`, Rounding Methods `account.cash.rounding`, Account Tags `account.account.tag`, Fiscal Years `account.fiscal.year` (list/form)
    - Accounting Reports `account.report`, Horizontal Groups `account.report.horizontal.group` (list/form)
    - Checks `account.return.check.template`, Fiscal Categories `account.fiscal.category`, Return Types `account.return.type` (list/form)
    - Depreciation Models `account.depreciation.model` list/kanban/form
    - Invoice Reminders `account_followup.followup.line` list/kanban/form
    - Financial Budgets `account.report.budget` list/form
    - Online Synchronization `account.online.link` list/form
  - Invoicing
    - Payment Terms `account.payment.term` list/kanban/form
    - Incoterms `account.incoterms` list/form
    - Product Categories `product.category` list/form
  - Analytic Accounting
    - Analytic Distribution Models `account.analytic.distribution.model` list/form
    - Analytic Accounts `account.analytic.account` list/kanban/form
    - Analytic Plans `account.analytic.plan` list/form

## Equity

- Dashboard (server)
- Ownership: Transactions `equity.transaction`, Valuations `equity.valuation`, UBO `equity.ubo`
- Reporting: Cap Table (client), Cap Table Pivot `equity.cap.table` pivot, Valuation (client)
- Configuration: Security Classes `equity.security.class`

## ESG

- Dashboard (client)
- Collect
  - Emitted / Offset Emissions `esg.carbon.emission.report` list/kanban/graph/pivot/form
  - Metrics `esg.metric` list/kanban/form
- Measure
  - Employee Commuting `esg.employee.commuting.report` pivot
  - Carbon Analytics `esg.carbon.emission.report` graph/pivot
  - Carbon Footprint (client)
  - Sex Parity / Pay Gap `esg.employee.report` graph/pivot
- Report: VSME Report, CSRD Report `esg.report` kanban
- Act: Actions `esg.action` list/pivot/form
- Configuration: Emission Factors `esg.emission.factor`, Emission Sources `esg.emission.source`, Assignation Rules `esg.assignation.line`, Gases `esg.gas`, Databases `esg.database`

## Documents

- Documents (client)
- Configuration
  - Settings `res.config.settings` form
  - Spreadsheet Templates `spreadsheet.template` list
  - Tags `documents.tag` list/form
  - Groups `res.group.functional` list/form
  - Activity Types / Activity Plans

## Project

- Projects `project.project` kanban/list/form/gantt/calendar/activity
- Tasks
  - My Tasks `project.task` kanban/list/form/gantt/calendar/map/activity/pivot/graph
  - All Tasks `project.task` kanban/list/form/gantt/calendar/map/activity/pivot/graph
- Reporting
  - Tasks Analysis `report.project.task.user` graph/pivot
  - Customer Ratings `rating.rating` kanban/list/pivot/graph/form
  - Margins `account.analytic.line` pivot/graph/list/kanban/form
  - Forecast Margins `sale.report` list/pivot/graph/kanban
- Configuration
  - Settings `res.config.settings` form
  - Projects / Project Templates `project.project` list/kanban/form
  - Project Roles `project.role` list/kanban/form
  - Project Stages `project.project.stage` list/kanban/form
  - Task Stages `project.task.type` list/kanban/form
  - Tags `project.tags` list/form
  - Activity Types / Activity Plans

## Timesheets

- Timesheets
  - My Timesheets `account.analytic.line` grid/list/form
  - All Timesheets `account.analytic.line` grid/list/kanban
- Assistant (client)
- To Validate
  - Last Period `account.analytic.line` grid/list/kanban/form
  - All Timesheets `account.analytic.line` pivot/grid/list/kanban/form
- Reporting
  - By Employee / By Project / By Task / By Billing Type `timesheets.analysis.report` pivot/graph
  - Timesheets / Attendance Analysis `hr.timesheet.attendance.report` graph/pivot
- Configuration
  - Settings `res.config.settings` form
  - Assistant Rules `aw.rule` list/kanban/form
  - Employee Targets `hr.employee` list/kanban/form
  - Tips `hr.timesheet.tip` list/form

## Planning

- Schedule
  - By Resource / By Role / By Sales Order `planning.slot` gantt/calendar/list/form/kanban/pivot/graph
  - Service Requests `planning.slot` list/kanban/activity/form
- Maps
  - By Resource / Live Map `planning.slot` map/gantt/calendar/list/form/kanban/pivot/graph
  - Timeline `planning.slot` map/form
- Planning: My / All `planning.slot` calendar/gantt/list/form/kanban/map
- Reporting
  - Planning Analysis `planning.analysis.report` pivot/graph
  - Planning & Attendance Analysis `planning.attendance.analysis.report` pivot/graph
  - Customer Ratings `rating.rating`
- Configuration
  - Employees `hr.employee` kanban/list/form/activity/graph/pivot
  - Materials `resource.resource` list/kanban/form
  - Roles `planning.role` list/kanban/form
  - Shift Templates `planning.slot.template` list/kanban/form
  - Products `product.template` kanban/list/activity/form

## Helpdesk

- Overview `helpdesk.team` kanban/form
- Tickets
  - My Tickets / All Tickets `helpdesk.ticket` list/kanban/form/activity/pivot/graph/cohort
- Reporting
  - Tickets Analysis `helpdesk.ticket.report.analysis` pivot/graph
  - SLA Status Analysis `helpdesk.sla.report.analysis` pivot/graph/cohort
  - Customer Ratings `rating.rating`
- Configuration
  - Helpdesk Teams `helpdesk.team` list/form/kanban
  - Stages `helpdesk.stage` list/form/kanban
  - SLA Policies `helpdesk.sla` list/form/kanban
  - Tags `helpdesk.tag` list/form
  - Canned Responses `mail.canned.response` list/form/kanban
  - Chatbots `chatbot.script` list/form

## Website

- Site
  - Homepage, Menu Editor (client)
  - Content: Pages `website.page`, Events `event.event`, Courses `slide.channel`, Appointments `appointment.type`, Jobs `hr.job`, System Pages `website.technical.page`
  - This page: Properties, Optimize SEO, Link Tracker, HTML / CSS Editor, Edit Menu (client)
- eCommerce
  - Shop (act_url)
  - Orders `sale.order`, Abandoned Carts `sale.order`, Customers `res.partner`
  - Products `product.template`, Pricelists `product.pricelist`, Categories `product.public.category`, Attributes `product.attribute`, Ribbons `product.ribbon`, Attribute Categories `product.attribute.category`
- Reporting: Analytics, eCommerce (server), Online Sales `sale.report` pivot/graph, Visitors `website.visitor` kanban/list/form/graph, Page Views `website.track` list
- Configuration: Settings, Websites `website`, Apps `ir.module.module`, Appointments, Redirects `website.rewrite`, Menus `website.menu`, Payments `payment.provider`, Deliveries `delivery.carrier`, Zip Prefix `delivery.zip.prefix`, Product Feeds `product.feed`

## eLearning

- Courses: Courses `slide.channel` kanban/list/form, Contents `slide.slide`, Certifications `survey.survey`
- Reporting: Courses, Contents, Attendees `slide.channel.partner`, Reviews `rating.rating`, Quizzes `slide.question`
- Configuration: Settings, Course Groups `slide.channel.tag.group`, Content Tags `slide.tag`

## Social Marketing

- Feed `social.stream.post` kanban
- Posts `social.post` kanban/calendar/list/form/pivot
- Channels `im_livechat.channel` kanban/form
- Campaigns `utm.campaign` kanban/list/form
- Configuration: Social Media `social.media`, Social Accounts `social.account`, Social Streams `social.stream`

## Marketing Automation

- Campaigns `marketing.campaign` kanban/list/form
- Templates `mailing.mailing` kanban/form
- Reporting: Link Tracker `link.tracker`, Traces `marketing.trace`, Participants `marketing.participant` (graph/pivot/list/form)
- Configuration: Dynamic Lists `mailing.filter`, Mailings `mailing.mailing`, Activities `marketing.activity`

## Email Marketing

- Mailings `mailing.mailing` list/kanban/form/calendar
- Recipients: Mailing Lists `mailing.list`, Mailing Contacts `mailing.contact`, Dynamic Lists `mailing.filter`
- Templates `mailing.mailing` kanban/form
- Campaigns `utm.campaign` kanban/list/form
- Reporting: Mailing Analysis `mailing.trace.report` pivot/graph/list, Opt-Out Report `mailing.subscription`
- Configuration: Settings, Campaign Stages `utm.stage`, Campaign Tags `utm.tag`, Link Tracker `link.tracker`, Blacklisted Email Addresses `mail.blacklist`, Optout Reasons `mailing.subscription.optout`

## SMS Marketing

- SMS Marketing `mailing.mailing` list/kanban/form/calendar/graph
- Mailing Lists `mailing.list`, Mailing Contacts `mailing.contact`
- Campaigns `utm.campaign`
- Reporting `mailing.trace.report` graph/pivot/list
- Configuration: Blacklisted Phone Numbers `phone.blacklist`, Link Tracker `link.tracker`

## Events

- Events `event.event` kanban/calendar/list/gantt/form/pivot/graph/map/activity
- Registration Desk (client)
- Reporting: Attendees `event.registration` graph/pivot/kanban/list/form/cohort, Revenues `event.sale.report` graph/pivot
- Configuration: Settings, Event Templates `event.type`, Event Stages `event.stage`, Event Tags Categories `event.tag.category`, Event Questions `event.question`, Mail Schedulers `event.mail`, Lead Generation `event.lead.rule`, Website Menus `website.event.menu`

## Surveys

- Surveys `survey.survey` kanban/list/form/activity
- Participants `survey.user_input` list/kanban/form
- Questions & Answers: Questions `survey.question`, Suggested Values `survey.question.answer`, Detailed Answers `survey.user_input.line`

## Purchase

- Orders
  - Requests for Quotation `purchase.order` list/kanban/form/pivot/graph/calendar/activity
  - Purchase Orders `purchase.order` list/kanban/form/pivot/graph/calendar/activity
  - Vendors `res.partner` list/kanban/form
- Products: Products `product.template` list/form
- Reporting: Purchase `purchase.report` graph/pivot
- Configuration
  - Settings `res.config.settings` form
  - Vendor Pricelists `product.supplierinfo` list/form/kanban
  - Attributes `product.attribute`, Categories `product.category`, Units & Packagings `uom.uom`

## Inventory

- Overview `stock.picking.type` kanban/form
- Operations
  - Transfers: Receipts, Deliveries, Internal (server); Manufacturings `mrp.production`
  - Jobs: Batch Transfers `stock.picking.batch` list/kanban/form
  - Adjustments: Physical Inventory (server); Scrap `stock.move` list/form
  - Procurement: Replenishment (server); References `stock.reference` list/form; run scheduler (server)
- Products
  - Products `product.template` kanban/list/form
  - Lots / Serial Numbers `stock.lot` list/form
  - Packages `stock.package` list/kanban/form
- Reporting
  - Stock `product.product` list/form
  - Stock by Location (server)
  - Moves History `stock.move.line` list/kanban/pivot/form
  - Moves Analysis `stock.move` list/form
  - Valuation Adjustments `product.value` list
  - Performance `stock.report` graph/pivot
  - Returns `stock.picking` graph/pivot/list/form
- Configuration
  - Settings `res.config.settings` form
  - Warehouse Management
    - Warehouses `stock.warehouse` list/form
    - Operations Types `stock.picking.type` list/form
    - Locations `stock.location` list/form
    - Routes `stock.route` list/form
    - Rules `stock.rule` list/form
    - Storage Categories `stock.storage.category` list/form
    - Putaway Rules `stock.putaway.rule` list
  - Products: Categories `product.category`, Attributes `product.attribute`, Units & Packagings `uom.uom`, Barcode Nomenclatures `barcode.nomenclature`
  - Delivery: Delivery Methods `delivery.carrier`, Package Types `stock.package.type`, Zip Prefix `delivery.zip.prefix`
  - Reporting: Manage Printers `printer.printer`

## Manufacturing

- Overview `mrp.workcenter` kanban/form
- Operations
  - Manufacturing Orders `mrp.production` list/kanban/form/gantt/calendar/pivot/graph/activity
  - Work Orders `mrp.workorder` list/kanban/form/calendar/pivot/graph/gantt
  - Unbuild Orders `mrp.unbuild` list/kanban/form/activity
  - Scrap `stock.move` list/form
- Planning: Work Orders Planning / Kanban, Employees Planning, run scheduler (server)
- Products
  - Products `product.template` kanban/list/form
  - Bills of Materials `mrp.bom` list/kanban/form
  - Lots/Serial Numbers `stock.lot` list/form
- Reporting
  - Work Orders `mrp.workorder` graph/pivot/list/form/gantt
  - Overall Equipment Effectiveness `mrp.workcenter.productivity` graph/pivot/list/form
  - Production Analysis `mrp.report` graph/pivot
- Configuration
  - Settings `res.config.settings` form
  - Work Centers `mrp.workcenter` list/kanban/form
  - Operations `mrp.routing.workcenter` list/kanban/form

## Shop Floor

- Shop Floor (client)

## Quality

- Overview `quality.alert.team` kanban/form
- Quality Control
  - Control Points `quality.point` list/kanban/form
  - Quality Checks `quality.check` list/kanban/form/pivot/graph/activity
  - Quality Alerts `quality.alert` kanban/list/form/pivot/graph/calendar/activity
- Products: Products `product.template`, Lots/Serial Numbers `stock.lot`
- Reporting: Quality Check Analysis `quality.check`, Quality Alerts Analysis `quality.alert`
- Configuration: Quality Teams `quality.alert.team`, Quality Alert Stages `quality.alert.stage`, Quality Tags `quality.tag`, Quality Spreadsheet Templates `quality.spreadsheet.template`

## Barcode

- Barcode (client)

## Maintenance

- Dashboard `maintenance.team` kanban/form
- Maintenance
  - Maintenance Requests `maintenance.request` kanban/list/form/pivot/graph/calendar/activity
  - Planning by Equipment / by Workcenter `maintenance.request` gantt/...
- Equipment
  - Work Centers `mrp.workcenter` list/kanban/form
  - Machines & Tools `maintenance.equipment` kanban/list/form
- Reporting: OEE, Losses Analysis, Maintenance Requests Analysis `maintenance.request`
- Configuration: Settings, Maintenance Teams `maintenance.team`, Equipment Categories `maintenance.equipment.category`, Maintenance Stages `maintenance.stage`, Activity Types

## Repairs

- Orders `repair.order` list/kanban/graph/pivot/form/activity
- Reporting: Repairs `repair.order`
- Configuration: Products `product.template`, Repair Orders Tags `repair.tags`

## PLM

- Overview `mrp.eco.type` kanban/form
- Changes `mrp.eco` kanban/list/calendar/pivot/graph/form/activity
- Master Data: Products `product.template`, Bill of Materials `mrp.bom`, Work Centers `mrp.workcenter`
- Reporting: ECOs `mrp.eco` graph/pivot
- Configuration: ECO Stages `mrp.eco.stage`, ECO Types `mrp.eco.type`, ECO Tags `mrp.eco.tag`

## Sign

- Documents: My Documents / All Documents `sign.request` list/kanban/form/pivot/graph/activity
- Templates `sign.template` kanban/list/form
- Reports: Green Savings (report)
- Configuration: Settings, Fields `sign.item.type`, Tags `sign.template.tag`

## Employees

- Management `hr.employee` kanban/list/form/activity/graph/pivot
- Directory `hr.employee.public` kanban/list/form
- Departments `hr.department` kanban/list/form
- Learning: Certifications (server), Training Attendances `hr.resume.line` list/kanban/form/calendar, Courses eLearning `slide.channel` / Onsite `event.event`
- Reporting: Headcount `hr.payroll.headcount` list/form, Skills Inventory `hr.employee.skill.report` list/pivot
- Configuration
  - Settings `res.config.settings` form
  - Employee: Onboarding / Offboarding `mail.activity.plan`, Employee Types `hr.employee.type`, Work Locations `hr.work.location`, Departure Reasons `hr.departure.reason`, Skill Types `hr.skill.type`, Tags `hr.employee.category`
  - Time Management: Working Schedules `resource.calendar`, Time Types `hr.work.entry.type`
  - Resume: Sections `hr.resume.line.type`
  - Recruitment: Job Positions `hr.job`, Contract Templates `hr.version`
  - Challenges: Badges `gamification.badge`, Challenges `gamification.challenge`, Goals History `gamification.goal`

## Appraisals

- Appraisals `hr.appraisal` kanban/list/gantt/calendar/form/activity/graph/pivot
- Goals `hr.appraisal.goal` list/kanban/form/graph
- Reporting: Appraisal Analysis `hr.appraisal` graph, Skills Evolution `hr.appraisal.skill.evolution.report`
- Configuration: Settings, Appraisal Templates `hr.appraisal.template`, Evaluation Scale `hr.appraisal.note`, Skills `hr.skill.type`, 360 Feedback `survey.survey`, Goals Library `hr.appraisal.goal` (hierarchy), Goal Tags `hr.appraisal.goal.tag`, Activity Types / Plans

## Attendances

- My Attendances `hr.attendance` calendar/gantt/list/pivot/graph
- Management: Dashboard `hr.attendance` gantt/list/form, Employees `hr.employee.public` kanban, Attendances `hr.attendance` list/form
- Kiosk Mode (server)
- Reporting: Attendances `hr.attendance` pivot/graph, Time Off Ledger `hr.leave.attendance.report`
- Configuration: Time Types `hr.work.entry.type`, Settings, Automatic Rules `hr.time.rule`, Onboarding (server)

## Recruitment

- Applications
  - By Job Positions `hr.job` kanban/list/form
  - By Talent Pools `hr.talent.pool` kanban/list/form
  - All Applications `hr.applicant` kanban/list/form/pivot/graph/calendar/activity
- Reporting: Application Analysis, Source Analysis, Team Performance `hr.recruitment.report`; Hiring Velocity `hr.recruitment.stage.report` (cohort)
- Configuration
  - Job Positions: Stages `hr.recruitment.stage`, Employee Types `hr.employee.type`, Job Tags `hr.job.tag`
  - UTMs: Sources `utm.source`, Mediums `utm.medium`, Campaigns `utm.campaign`
  - Applications: Degrees `hr.recruitment.degree`, Refuse Reasons `hr.applicant.refuse.reason`, Tags `hr.applicant.category`
  - Employees: Departments `hr.department`, Skill Types `hr.skill.type`
  - Job Boards: Emails `hr.job.platform`

## Referrals

- Dashboard (client)
- Reporting: Referral Analysis `hr.referral.report`, Rewards `hr.referral.reward.report`, Points `hr.referral.points`, Link Tracker (server)
- Configuration: Job Positions `hr.job`, Alerts `hr.referral.alert`, Rewards `hr.referral.reward`, Levels `hr.referral.level`, Friends `hr.referral.friend`, Onboarding `hr.referral.onboarding`

## Time Off

- My Time: Days Off `hr.leave` calendar/list/form/activity; Requests `hr.leave.allocation` list/kanban/form/activity
- Overview `hr.leave.report.calendar` gantt/calendar
- Management: Time Off `hr.leave` list/kanban/gantt/form/calendar/activity; Allocations `hr.leave.allocation` kanban/list/form/activity
- Reporting: by Employee `hr.leave.employee.report`, by Type `hr.leave.report`, Balance (server)
- Configuration: Time Types `hr.work.entry.type`, Accrual Plans `hr.leave.accrual.plan`, Company Holidays `resource.calendar.leaves`, Mandatory Days `hr.leave.mandatory.day`, Automatic Rules `hr.time.rule`, Activity Types

## Fleet

- Fleet
  - Fleet `fleet.vehicle` kanban/list/form/pivot/activity
  - Contracts `fleet.vehicle.log.contract` list/kanban/form/graph/pivot/activity
  - Services `fleet.vehicle.log.services` list/kanban/form/graph/pivot/activity
  - Odometers `fleet.vehicle.odometer` list/form
- Reporting: Costs `fleet.vehicle.cost.report` graph/pivot, Odometers `fleet.vehicle.odometer.report` graph/list
- Configuration: Settings, Manufacturers `fleet.vehicle.model.brand`, Models `fleet.vehicle.model`, Categories `fleet.vehicle.model.category`, Contract/Service Types `fleet.service.type`, Status `fleet.vehicle.state`, Tags `fleet.vehicle.tag`

## Payroll

- Dashboard (client)
- Employees: Employees `hr.employee`, Employee Records `hr.version` list/graph/pivot, Payslip Adjustments `hr.salary.attachment` list/form/pivot
- Time Offs `hr.leave` gantt
- Payslips: Payslips `hr.payslip` list/form/activity; Pay Runs `hr.payslip.run` kanban/calendar/pivot/graph/list
- Reporting: Payslips `hr.payslip.line`, Working Days `hr.payslip.worked_days`, Other Inputs `hr.payslip.input` (pivot/list); Audit Trail `mail.message`
- Configuration
  - Contracts: Templates `hr.version`, Employee Types `hr.employee.type`
  - Time Management: Time Types `hr.work.entry.type`, Working Schedules `resource.calendar`, Company Holidays `resource.calendar.leaves`
  - Salary: Benefits `hr.contract.salary.benefit`, Premium Pay / Rule Categories `hr.salary.rule.category`, Structure Types `hr.payroll.structure.type`, Structures `hr.payroll.structure`, Rules `hr.salary.rule`, Salary Input Sections `hr.salary.rule.section`, Rule Parameters `hr.rule.parameter`
  - Dashboard: Warnings `hr.payroll.warning`

## Expenses

- My Expenses: My Expenses / Expenses to Process `hr.expense` list/kanban/form/graph/pivot/activity
- Reporting: Expenses Analysis `hr.expense` graph/pivot/list/form
- Configuration: Settings, Expense Products `product.product`, Activity Types

## Frontdesk

- Stations `frontdesk.frontdesk` kanban/form/list
- Visitors `frontdesk.visitor` list/form/kanban/graph/pivot/calendar/gantt

## Lunch

- My Lunch: New Order `lunch.product`, My Order History `lunch.order`, My Account History `lunch.cashmove.report`
- Manager: Today's Orders / Control Vendors `lunch.order`, Control Accounts `lunch.cashmove.report`, Cash Moves `lunch.cashmove`
- Configuration: Vendors `lunch.supplier`, Locations `lunch.location`, Products `lunch.product`, Product Categories `lunch.product.category`, Alerts `lunch.alert`

## Live Chat

- Channels `im_livechat.channel` kanban/form
- Sessions `discuss.channel` kanban/list/pivot/graph/form
- Visitors `website.visitor` kanban/list/form/graph
- Reporting: Agents Performance `im_livechat.channel.member.history`, Sessions Analysis `im_livechat.report.channel`
- Configuration: Live Chat Channels, Canned Responses `mail.canned.response`, Chatbots `chatbot.script`, Expertise `im_livechat.expertise`

## Data Cleaning

- Deduplication `data_merge.record` list/form
- Recycle Records `data_recycle.record` list/form
- Field Cleaning `data_cleaning.record` list/form
- Configuration: Rules (Deduplication `data_merge.model`, Recycle `data_recycle.model`, Field Cleaning `data_cleaning.model`), Manual Merge `ir.model`

## Approvals

- Dashboard `approval.category` kanban
- My Approvals: My Requests `approval.request` kanban/list/form
- Manager: Approvals to Review / All Approvals `approval.request` list/form/kanban
- Configuration: Approval Categories `approval.category` list/form; Products `product.template`

## WhatsApp

- Templates: Message Templates `whatsapp.template`, Interactive Templates `whatsapp.interactive`
- Messages `whatsapp.message` list/graph
- Configuration: WhatsApp Business Accounts `whatsapp.account`, WhatsApp Blocklist `whatsapp.blocklist`

## Phone

- Calls `voip.call` list/kanban/calendar/graph/pivot/form
- Phone Numbers: Phone Numbers `voip.did.number`, Number Requests `voip.did.number.request`
- Configuration: Providers `voip.provider`; PBX: Extensions, Call Flows, Time Conditions, Groups, Menus (IVR), Queues, Voice Mailboxes, Sounds, Music on Hold

## Link Tracker

- Link Tracker `link.tracker` list/form/graph
- UTMs: Campaigns `utm.campaign`, Mediums `utm.medium`, Sources `utm.source`

## Marketing Card

- Campaigns `card.campaign` list/kanban/form
