# پرامپت‌های Claude Code برای اجرای برنامه تجاری‌سازی

این فایل همراه [`SaaS-Commercialization-Plan.md`](SaaS-Commercialization-Plan.md) است. هر پرامپت یک کار مشخص است که در یک branch و یک PR تمام می‌شود.

## روش استفاده در VS Code

1. پوشه repo را در VS Code باز کنید، ترمینال را باز کنید (`` Ctrl+` ``) و `git checkout main && git pull` بزنید.
2. دستور `claude` را بزنید.
3. **پرامپت ۰ را فقط یک بار** اجرا کنید. قوانین پروژه را در `CLAUDE.md` می‌گذارد و Claude Code در همه جلسه‌های بعدی خودش آن را می‌خواند.
4. برای هر کار بعدی یک جلسه تازه باز کنید (`/clear` یا بستن و دوباره `claude`) و فقط **یک** پرامپت را کپی کنید.
5. Claude Code کار را روی یک branch جدا انجام می‌دهد و PR باز می‌کند. PR را بخوانید و فقط وقتی راضی بودید merge کنید. **هر merge به main مستقیم روی سرور اصلی می‌رود.**
6. ترتیب پرامپت‌ها مهم است. پرامپتی را شروع نکنید که پیش‌نیازش هنوز merge نشده.
7. هیچ‌وقت رمز، کلید API یا آدرس دیتابیس را داخل پرامپت ننویسید. اگر Claude Code به آن‌ها نیاز داشت، در فایل `.env.local` بگذارید (این فایل در git نمی‌رود).
8. **قانون اسکیل‌ها:** Claude Code اسکیل‌های نصب‌شده را می‌بیند ولی خودش از آن‌ها استفاده نمی‌کند. برای همین متن زیر را در ابتدای هر پرامپت (بالای متن پرامپت) قرار دهید:

```text
Before starting, check the list of available skills. Use every skill that fits this task.
At the end, say which skills you used, or that none fit.
```

متن پرامپت‌ها انگلیسی است چون کد و مستندات فنی repo انگلیسی است و Claude Code با آن دقیق‌تر کار می‌کند. می‌توانید یک خط فارسی هم اضافه کنید.

---

## پرامپت ۰: قوانین پروژه (فقط یک بار)

```text
Read docs/SaaS-Commercialization-Plan.md fully (it is in Persian; read it carefully). Then append a
section "## SaaS program rules" to CLAUDE.md, below the existing @AGENTS.md line, with exactly these rules,
and open a PR for it on a new branch:

1. Every task runs on its own branch (saas/<short-name>) and ends in a PR. Never push to main:
   every merge to main auto-deploys to production (erp.del-groups.com).
2. Before writing Next.js code, read the relevant guide in node_modules/next/dist/docs/ (this is Next 16;
   middleware is src/proxy.ts).
3. One SQL migration file per DB change, in supabase/migrations/. Its timestamp prefix must be unique:
   check `ls supabase/migrations` and the open PRs before choosing it.
4. Never run SQL or migrations against the production Supabase project. Write the migration, test it
   on a local or branch database, and say in the PR exactly what to run and in which order.
5. Never print, commit or ask for secrets. Read them from .env.local only.
6. New behaviour ships behind a feature flag or an admin-only page, off by default, so merging does
   not change what Del Groups staff see.
7. Before opening a PR run: npm run lint, npm test, npm run build. All must pass. Add tests for new logic.
8. Every UI string goes through src/i18n (az, en, ru).
9. Odoo is a reference for concepts and workflows only. Never copy Odoo code, icons, texts or branding.
10. UI references from vibeprompts.dev are copied locally in docs/ui-library/vibeprompts/
    (<category>/<slug>.html preview + <category>/README.md with the prompt). A reference written as
    "dashboards/dashboards-kanban-board-with-drag-and-drop" means that file. Rebuild them as typed React
    components using our design tokens, Radix and the motion library; never paste their vanilla JS.
11. PR description: what changed in plain words, how it was tested, and any manual step Del must do.
12. Keep each PR focused on its task. If you find unrelated problems, list them in the PR, don't fix them.
```

---

## فاز ۱: پایه فنی

### پرامپت ۱: Schema پایه قابل تکرار

```text
Task: make it possible to build a complete, empty Del Groups ERP database from the repo with one command.

Context: today a fresh DB needs 35 legacy files in types/*.sql run by hand plus 117 files in
supabase/migrations, and some changes were applied manually in production, so the files may not match
the live DB. Section 2 and 5.3 of docs/SaaS-Commercialization-Plan.md explain why this is phase 1.

Do:
- Ask me to run `supabase db dump --schema public,storage --file /tmp/live-schema.sql` myself with the
  production DB URL from my .env.local (do not ask me to paste the URL). Use that dump as the source of truth.
- Create supabase/baseline/ with a clean, ordered, idempotent baseline (extensions, types, tables,
  functions, triggers, RLS policies, storage buckets and policies, seed data needed to boot: roles,
  permissions, default settings). No business data.
- Add scripts/db/build-fresh.sh that applies the baseline to an empty Postgres (local `supabase start`).
- Add a GitHub Actions workflow (not the deploy workflow) that starts a local Supabase stack, applies
  the baseline, runs a schema diff against the committed dump, and fails on any difference.
- Document in supabase/baseline/README.md how new migrations relate to the baseline from now on.

Done when: build-fresh.sh creates a DB with the same tables, functions, triggers and policies as
production (show the diff output in the PR), and the new workflow is green.
```

### پرامپت ۲: کانفیگ Supabase در زمان اجرا

```text
Task: stop baking the Supabase URL and anon key into the build, so one build can serve many tenants.

Context: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are read in src/lib/env.ts and inlined
at build time; /api/public-config already serves them from server env. Server clients are in
src/lib/supabaseServer.ts, src/lib/supabaseAdmin.ts and src/lib/supabase/.

Do:
- Introduce src/lib/tenant/config.ts with getTenantConfig(request|headers) that, for now, returns the
  single config from server env (the multi-tenant lookup comes in a later task). Every Supabase client
  (browser, server, admin, proxy.ts auth check) must get its URL/keys through it.
- The browser client loads its config from /api/public-config (cached) instead of process.env.NEXT_PUBLIC_*.
- Keep the NEXT_PUBLIC_* variables working as a fallback so the current deployment does not break.
- Unit-test the config resolution.

Done when: a production build made WITHOUT NEXT_PUBLIC_SUPABASE_* build args works when the values are
only in the runtime env. Explain in the PR how you verified it (docker build + run).
```

### پرامپت ۳: حذف مقادیر ثابت Del Groups

```text
Task: make the ERP company-neutral. Find every hard-coded Del Groups detail (name, VÖEN, address,
bank details, phone, logo, seal, email, domain, default currency/VAT assumptions) and move it to company
settings.

Do:
- grep -ri "del groups\|del-groups\|delgroups" src (about 41 files) plus print templates, PWA manifest,
  emails and AI system prompts.
- Store the values in system_settings (or a new company_profile table if cleaner; one migration),
  pre-filled by the migration with the exact current Del Groups values so nothing changes visually.
- Add a "Company" section to settings to edit them (admin only), with logo/seal upload to the existing buckets.
- Product name shown in the UI comes from one constant (PRODUCT_NAME) so it can be renamed later.

Done when: grep finds no Del Groups specifics outside the migration seed and tests; screenshots in the
PR show invoice print, login page and header unchanged.
```

---

## فاز ۲: هسته و ماژول‌ها

### پرامپت ۴: manifest و رجیستری ماژول‌ها

```text
Task: introduce the module system from section 5 of docs/SaaS-Commercialization-Plan.md WITHOUT changing
any screen.

Do:
- Create src/modules/registry.ts and defineModule() with the manifest shape in section 5.1 (id, version,
  depends, permissions, menus, routes, aiTools, settings).
- Write a manifest for every current area: core, sales, purchases, inventory (incl. warehouses, transfers,
  counts, audits), polywood, production, accounting (finance, cash-bank, journal, reports), expenses, hr,
  payroll, crm, contracts, consignment, commissions, tax-az, barcode, ai, studio.
- Generate navigation (src/lib/navigation/navConfig.ts), route permissions (src/lib/auth/routePermissions.ts)
  and the permission matrix (src/lib/auth/permissionMatrix.ts) from the registry instead of hand-written lists.
- Validate the dependency graph at build time (unknown dependency or cycle = build error); unit-test it.
- Do NOT move component files yet.

Done when: the generated menu and route permissions are identical to the current ones (add a test that
compares them) and the app looks exactly the same.
```

### پرامپت ۵: نصب/غیرفعال کردن ماژول برای هر شرکت

```text
Task: let a tenant have only some modules enabled.

Do:
- One migration: table tenant_modules (module_id, enabled, installed_at, version), seeded with every
  module enabled, readable by all authenticated users, writable only by service role.
- A server helper getEnabledModules() (cached per request) and a client hook useEnabledModules().
- Gate by enabled modules: menu items, src/proxy.ts route access (show a friendly "not in your plan"
  page), server actions and API routes (shared guard), AI tools in src/lib/ai/native/tools.ts, dashboard widgets.
- Enabling a module also enables its dependencies; disabling never deletes data.
- Add an admin-only page under settings that lists modules and their state (read-only for now).

Done when: with a module disabled in the table, it disappears from the menu, its routes and API return
the "not in your plan" response, and the AI cannot call its tools. Tests cover the guard.
```

### پرامپت ۶: انتقال کد به پوشه ماژول‌ها

```text
Task: move code into src/modules/<id>/ one module at a time, starting with crm (smallest), then
contracts, consignment, commissions, expenses, hr, payroll, production, polywood, purchases, sales,
inventory, accounting.

For ONE module per PR (start with crm):
- Move its components, lib, actions and hooks into src/modules/<id>/{components,lib,actions,hooks}.
- Pages in src/app stay as thin wrappers that import from the module.
- Cross-module calls go through exported functions in src/modules/<id>/index.ts or through erp_events,
  never deep imports into another module's internals. Add an ESLint rule (no-restricted-imports) that enforces it.
- Move that module's SQL into supabase/modules/<id>/ as its install script (baseline part), keeping
  supabase/migrations for changes.

Done when: lint, tests and build pass, the module works the same, and the PR lists the next module.
Then stop; I will start a new session for the next module.
```

---

## فاز ۳: کنترل‌پنل MVP

### پرامپت ۷: دیتابیس و برنامه کنترل‌پنل

```text
Task: create the control plane from section 4 of docs/SaaS-Commercialization-Plan.md.

Do:
- New Next.js app in control-panel/ (same repo, separate Dockerfile and compose service, deployed later
  as admin.<product-domain>). Reuse src/design-system tokens.
- Its own Supabase project: I will create it and put its URL/keys in control-panel/.env.local. Write the
  schema as migrations in control-panel/supabase/migrations: tenants, tenant_databases, tenant_domains,
  tenant_secrets (values via Supabase Vault only), modules, plans, plan_prices, subscriptions,
  subscription_items, invoices, payments, usage_snapshots, platform_admins, platform_audit_log, with RLS
  so only platform_admins can read/write.
- Screens: login (platform admins only), tenants list, tenant detail (status, domain, modules, users count,
  DB version), plans list. Every action writes platform_audit_log.

Done when: I can log in as a platform admin and create/edit a tenant record (no provisioning yet).
Lint, tests and build pass for both apps.
```

### پرامپت ۸: تشخیص مستأجر از روی دامنه

```text
Task: make the ERP serve many tenants from one deployment.

Do:
- In src/lib/tenant/config.ts (from prompt 2) resolve the tenant from the Host header via a control-plane
  lookup (server-only, service key from env, cached in memory for 60 s, invalidated by a signed webhook
  from the control panel).
- src/proxy.ts: unknown host -> 404 page; tenant status read_only -> allow GET pages, block mutations
  with a clear banner; suspended -> "account suspended" page; provisioning -> "being prepared" page.
- Server actions and API routes use the tenant's Supabase URL/keys. Service-role keys are fetched from
  the control plane at runtime and never sent to the browser.
- Fallback: if no control plane is configured (env var missing) keep today's single-tenant behaviour.
- Caddy: document in DEPLOYMENT.md the on-demand TLS config with an "ask" endpoint
  (/api/tenant/domain-check) that only approves registered domains.

Done when: running locally with two tenant records pointing at two local Supabase stacks, acme.localhost
and beta.localhost each show only their own data. Add an automated test for the resolution and the status rules.
```

### پرامپت ۹: ساخت خودکار شرکت جدید

```text
Task: one-click provisioning of a new tenant from the control panel (section 4.3 of the plan).

Do:
- A provisioning job (control-panel server, resumable step by step, each step idempotent and logged):
  create Supabase project via the Management API (EU region) -> wait healthy -> apply supabase/baseline
  + install scripts of the selected modules -> set Auth site URL, redirect URLs and email templates ->
  create storage buckets -> store keys in Vault -> seed tenant_modules -> create the tenant admin and send
  the invite -> mark tenant trial/active.
- Retry button for a failed step; full log on the tenant page.
- The Supabase Management API token comes from control-panel env; never log it.

Done when: creating a test tenant from the panel produces a working ERP at <slug>.<domain> where the
invited admin can log in and finish the setup wizard. Show the step log in the PR.
```

### پرامپت ۱۰: اجرای مایگریشن روی همه شرکت‌ها

```text
Task: after a merge to main, apply new migrations to every tenant database safely.

Do:
- scripts/tenants/migrate-all.ts: reads tenants from the control plane, applies pending files from
  supabase/migrations to the canary tenant first, then the rest in batches; stops on the first failure;
  records the applied version per tenant in tenant_databases.
- A manual GitHub Actions workflow (workflow_dispatch, not automatic) that runs it with secrets.
- A "DB version" column and a "migrate this tenant" button in the control panel.

Done when: with three local tenants, a new test migration lands on the canary first, then the others,
and a deliberately broken migration stops the run after the canary.
```

### پرامپت ۱۱: ثبت Del Groups به‌عنوان مستأجر شماره ۱

```text
Task: register the existing production Supabase project as tenant #1 without moving any data.

Do (prepare everything, but do not touch production yourself):
- A script and a step-by-step runbook in docs/runbooks/tenant-1-cutover.md: backup (pg_dump), test on a
  Supabase branch copy, register the tenant record and domain erp.del-groups.com in the control plane,
  apply pending migrations (tenant_modules etc.), switch the ERP container to multi-tenant mode, verify
  checklist, rollback steps.
- A smoke-test script that checks login, sales list, invoice print and stock levels after the switch.

Done when: the runbook has been rehearsed end to end on a branch copy (show the output in the PR).
I (Del) will run the production steps myself or ask for them explicitly.
```

---

## فاز ۴: پلن، محدودیت و پرداخت

### پرامپت ۱۲: پلن‌ها و محدودیت‌ها

```text
Task: plans priced by modules and users, and enforcement of limits (sections 4.2 and 4.4 of the plan).

Do:
- Control panel: plan editor (base fee, per-module per-user price, monthly/yearly with yearly discount,
  add-ons: extra users, storage, AI credits, custom domain), subscription editor for a tenant with a live
  price preview including proration. Use vibeprompts.dev pricing/pricing-module-bundle-builder,
  pricing/pricing-per-seat-pricing-with-quantity-stepper and pricing/pricing-change-plan-with-prorated-preview
  as design references. Price calculation in a pure, unit-tested module.
- Subscription changes sync enabled modules to the tenant's tenant_modules.
- Seat limit: inviting/activating a user in the ERP (/api/users) checks the plan; a DB trigger in the
  tenant blocks exceeding it as a second layer. Show cta/cta-seat-limit-collaboration-nudge style message.
- Daily usage snapshot job (active users, storage bytes, AI cost from ai_usage_log) -> usage_snapshots;
  warnings at 80 % and blocking at 100 % for storage uploads and AI questions.

Done when: tests cover price math, proration and each limit; a tenant on a 5-user plan cannot add a 6th.
```

### پرامپت ۱۳: صورتحساب و درگاه پرداخت

```text
Task: invoicing and payments for subscriptions.

Do:
- PaymentProvider interface (createCheckout, chargeSavedCard, refund, webhook verify) with two
  implementations: ManualBankTransfer (invoice PDF with bank details, admin marks as paid) and a stub for
  the local card gateway I choose (I will give you its API docs; keep keys in env).
- Invoice generation on renewal, PDF, email to the tenant admin, numbering per year.
- Dunning: due -> 7-day grace -> read_only -> 30 days -> suspended (configurable); emails at each step;
  automatic reactivation on payment.
- Tenant-side billing page in the ERP (admin only): plan, usage meters
  (dashboards/dashboards-usage-and-billing-meters as reference), invoices, upgrade/downgrade request.

Done when: a simulated unpaid invoice walks the tenant through every state and back to active after
payment, covered by tests.
```

---

## فاز ۵: بررسی Odoo

### پرامپت ۱۴: گزارش ساختاری Odoo

پیش‌نیاز: یک دیتابیس تست Odoo و یک یوزر جداگانه. این کار به مرورگر نیاز دارد. اگر Claude Code شما به Chrome وصل است (دستور `/chrome`)، همین‌جا اجرا کنید. اگر نه، در یک thread پروژه که Claude in Chrome دارد بخواهید. **خودتان در Chrome وارد Odoo شوید؛ رمز را به Claude ندهید.**

```text
Task: produce docs/Odoo-Structural-Report.md, a structural technical report of Odoo for our ERP.

I am already logged in to a TEST Odoo database in Chrome. Never enter or ask for credentials.
- From Apps, install every app. For each app: open every menu, list the models and key fields you can
  see (enable developer mode for technical names), views (list/kanban/form/pivot/graph/calendar/gantt/map),
  states and buttons, settings, reports, automations, and how it links to other apps.
- Use it like a real company for one end-to-end flow: lead -> opportunity -> quotation -> sale ->
  delivery -> invoice -> payment; purchase -> receipt -> vendor bill; manufacturing order with BoM;
  employee, time off, expense, payroll if available; a project with tasks and timesheets; a calendar
  meeting; a to-do; a document in Documents.
- For each app compare with our ERP (read src/modules or src/app) and fill a gap table:
  "we have / partial / missing", and a priority suggestion.
- Note UI/UX patterns worth keeping and ones we can do better (with screenshots saved under
  docs/odoo-report-assets/).
- Write concepts only; do not copy Odoo texts or code.

Done when: the report covers every installed app and the gap table, in a PR.
```

---

## فاز ۶: UI/UX جدید

### پرامپت ۱۵: سیستم طراحی و موشن

```text
Task: extend the design system for the new UI (section 6 of the plan). No screen changes yet.

Do:
- Extend src/design-system/tokens.* with per-tenant brand colour (CSS variables set from company
  settings), dark mode, density (compact/comfortable), radius and elevation scales, Latin + Cyrillic font.
- Add the `motion` package. Create src/design-system/motion.ts with shared transitions (page, list item,
  shared layout for record open, count-up), all respecting prefers-reduced-motion, 200-300 ms.
- Build typed React components in src/design-system/components using these vibeprompts.dev pages as
  references (rebuild, don't paste): bonus/bonus-command-palette, bonus/bonus-toast-notification,
  bonus/bonus-empty-state, bonus/bonus-skeleton-loading-state, bonus/bonus-file-upload-dropzone,
  bonus/bonus-type-to-confirm-delete-dialog, stats/stats-metric-cards-with-sparkline-bars,
  stats/stats-ring-gauge-trio, stats/stats-conversion-funnel-steps, stats/stats-goal-progress-bars,
  stats/stats-cohort-retention-heatmap, stats/stats-count-up-metrics-on-view,
  dashboards/dashboards-chart-card-with-legend.
- A /dev/design page (admin only, behind NEW_UI flag) showing every component in light and dark.

Done when: all components render on /dev/design in both themes, keyboard accessible, with tests for logic.
```

### پرامپت ۱۶: پوسته جدید و App Launcher

```text
Task: the new app shell behind the NEW_UI feature flag (per user toggle for admins).

Do:
- Home = App Launcher: grid of enabled modules (from the registry + tenant_modules), each tile with a
  live KPI and subtle motion on hover/open. Reference: nav/nav-multi-product-launcher-nav.
- Top bar: module name, module menus from the manifest, global search/command palette, notifications,
  AI assistant button, user menu. References: nav/nav-app-bar-with-search-and-tabs,
  nav/nav-breadcrumb-page-header, nav/nav-workspace-switcher-nav.
- Mobile: nav/nav-mobile-drawer-menu and nav/nav-bottom-tab-bar.
- Breadcrumbs that keep the path when jumping between related records.
- Old layout stays the default; the flag switches only the shell, old pages render inside it.

Done when: with the flag on, every existing page is reachable from the launcher and works inside the new shell.
```

### پرامپت ۱۷: موتور View

```text
Task: a generic, metadata-driven view engine (section 6.1 of the plan).

Do:
- src/views/: ListView, KanbanView, FormView, PivotView, GraphView, CalendarView, driven by a view
  definition (model, fields incl. Studio custom fields, grouping, actions, state bar).
- Shared SearchPanel: filters, group by, favourites (saved per user in one new table), Excel export.
  Reference: dashboards/dashboards-data-table-with-toolbar.
- Kanban with drag between stages (reference dashboards/dashboards-kanban-board-with-drag-and-drop,
  rebuilt in React with keyboard support). Calendar with day/week/month (reference
  dashboards/dashboards-week-schedule-grid).
- FormView: status bar, action buttons, tabs, and a slot for Chatter on the right.
- Data access through one typed data layer on TanStack Query that respects RLS and module gating.
- Prove it on one simple existing screen (CRM deals list + kanban) behind NEW_UI.

Done when: CRM deals work in list, kanban and form via the engine, with tests for view definitions and grouping.
```

### پرامپت ۱۸: انتقال UI یک ماژول (برای هر ماژول تکرار شود)

```text
Task: move the <MODULE> module screens to the new view engine behind NEW_UI.

Do:
- Read the module's current pages and src/modules/<MODULE>/manifest.ts, and the Odoo report section for
  the matching app (docs/Odoo-Structural-Report.md) if it exists.
- Write view definitions (list, kanban if it has stages, form, pivot/graph for reports) and a module
  dashboard with KPI cards and infographics from src/design-system.
- Keep every existing business rule and server action; only the UI layer changes.
- List any old feature you could not map and why.

Done when: every screen of the module works in the new UI with the same data and permissions, and old
pages still work with the flag off.
```

---

## فاز ۶ب: ماژول‌های جدید

### پرامپت ۱۹: Activities و Chatter

```text
Task: core Activities + Chatter (section 5.4 of the plan), used by every module.

Do:
- One migration: mail_messages (model, record_id, body, type note/message/log, author, attachments),
  mail_followers, activities (model, record_id, type, summary, due date, assigned user, state),
  activity_types (configurable). RLS: a user sees messages/activities of records they can read.
- Automatic change log: tracked fields write a log message (generalise the audit_logs approach).
- Chatter component for FormView: note, message, log, attachments, followers, schedule activity.
  References: dashboards/dashboards-activity-feed-panel, blog/blog-comment-thread-with-replies.
- "My activities" in the top bar with overdue/today/planned counts.

Done when: chatter and activities work on sales, purchases, customers and CRM deals, with RLS tests.
```

### پرامپت ۲۰: Calendar

```text
Task: new Calendar module (module id: calendar, depends on core).

Do:
- Migration: calendar_events (title, start, end, all_day, location, description, organizer,
  recurrence rule, privacy), calendar_attendees (user or partner, response), reminders.
- Calendar views (day/week/month, my/team calendars, colour by user) on the view engine.
- Activities of type "meeting" create events; events link to any record (deal, customer, sale).
- Email/in-app reminders. ICS export. Google/Outlook sync is a later task.

Done when: a user can plan a meeting with colleagues and a customer from a CRM deal, see it in their
team calendar and get a reminder. Tests for recurrence expansion.
```

### پرامپت ۲۱: CRM جدید

```text
Task: rebuild CRM like the Odoo CRM concepts in docs/Odoo-Structural-Report.md, keeping existing data.

Today: table deals (fixed stage column) and quotations.

Do:
- Migration (data-preserving): crm_teams, crm_stages (per team, sequence, won/lost flags), crm_leads with
  type lead/opportunity, partner, contact info, expected revenue, probability, expected close, tags,
  source/medium, lost reason; migrate every existing deal into crm_leads with mapped stages; keep
  quotations linked.
- Kanban pipeline with drag, quick create, activities and chatter; lead -> opportunity conversion;
  won/lost with reasons; sales targets per team.
- Quotation -> sales invoice conversion through the sales module's existing functions.
- Reports: funnel (stats/stats-conversion-funnel-steps), forecast by month, win rate by user, lost reasons.

Done when: all existing deals appear in the new pipeline with correct stages, and the full
lead -> opportunity -> quotation -> invoice flow works. Migration is reversible or has a backup step.
```

### پرامپت ۲۲: To-do

```text
Task: new To-do module (module id: todo, depends on core).

Do: personal tasks with personal stages (kanban), tags, priority, due date, checklist, assignees,
activities/chatter, quick capture from the command palette, conversion to a project task when the
project module exists. Views: kanban + list. Reference: bonus/bonus-drag-to-reorder-priority-stack.

Done when: a user can capture, organise and finish tasks, and see due tasks in "My activities".
```

### پرامپت ۲۳: Documents

```text
Task: new Documents module (module id: documents, depends on core).

Do:
- Migration: document_folders (tree, access rules by role/user), documents (file in storage, folder,
  tags, owner, linked model/record), document_requests (ask a user/partner for a file, due date).
- UI: folder tree + grid/list with preview (PDF, images), drag-and-drop upload
  (bonus/bonus-file-upload-dropzone), tags, bulk actions, "linked record" jump.
- Existing attachments (expense receipts, contracts, product images) appear in system folders without moving files.
- Storage usage counts toward the plan limit.

Done when: files can be uploaded, organised, previewed, shared by folder permissions and linked to records.
```

### پرامپت ۲۴: الگوی ساخت هر ماژول جدید دیگر

```text
Task: build the new <APP NAME> module (module id: <id>) based on the matching section of
docs/Odoo-Structural-Report.md and section 5.4 of docs/SaaS-Commercialization-Plan.md.

Do:
- Start with a short design note in the PR description: models, states, views, permissions, links to
  other modules, what we do differently from Odoo. Wait for my OK on the note before writing code.
- Then: manifest, one migration (+ install script under supabase/modules/<id>/), permissions, view
  definitions on the view engine, chatter/activities where records have a lifecycle, AI read tools,
  i18n (az/en/ru), tests.

Done when: the module installs on a tenant from the control panel and works end to end.
```

---

### پرامپت ۲۴ب: صفحه اصلی ویجتی و محدود کردن اطلاعات مالی به ادمین

**وضعیت امروز (بررسی کد، ۲۰۲۶-۱۰-۲۵):** در UI جدید صفحه اصلی همان App Launcher است (`src/app/apps/page.client.tsx`) با عرض حداکثر `max-w-5xl`، برای همین چپ و راست صفحه خالی است. زیر کاشی‌ها عدد زنده نشان داده می‌شود (`/api/shell/kpis`): «فروش این ماه» به آذن، تعداد فروش‌ها و موجودی کل حساب‌ها. این اعداد به هر کاربری که RLS اجازه خواندن جدول را بدهد نشان داده می‌شود، نه فقط ادمین. داشبورد قدیمی (`ManagementDashboardPage`) هم درآمد، هزینه و سود را به هر کسی که `can_view_dashboard` دارد نشان می‌دهد.

**مدل نقش در کد:** نقش‌های سیستمی `Admin` و `Manager` هستند و بقیه نقش‌های سفارشی‌اند. «ادمین به بالا» در کد یعنی `isAdminRole()` در فرانت و `public.user_is_admin()` در دیتابیس؛ نقشی بالاتر از Admin داخل هر شرکت وجود ندارد. `resolvePermissionPath()` برای ادمین همیشه true برمی‌گرداند، پس یک مجوز جدید `dashboard.view_financials` به‌طور پیش‌فرض فقط برای ادمین باز است و ادمین بعداً می‌تواند آن را به نقش دیگری (مثلاً Manager) بدهد.

**تصمیم‌ها (پیشنهاد داخل پرانتز). Del در ۲۰۲۶-۱۰-۲۵ همه را تأیید کرد؛ ماکت‌ها در فایل‌های پروژه، پوشه home-widgets:**

1. آیا نقش Manager هم اعداد مالی را ببیند؟ (خیر؛ فقط Admin. مجوز `dashboard.view_financials` وجود دارد و ادمین می‌تواند بعداً به Manager بدهد.)
2. بستن نشت فعلی (اعداد مالی زیر کاشی‌های Launcher و داشبورد قدیمی برای غیرادمین) فوراً و بدون فلگ منتشر شود؟ (بله؛ این محدودسازی است نه قابلیت جدید، و الان با `NEW_UI_AUDIENCE=all` همه کارکنان آن را می‌بینند.)
3. تعداد فروش‌ها (نه مبلغ) هم برای غیرادمین مخفی شود؟ (بله؛ زیر کاشی Trade برای غیرادمین عدد شخصی نشان داده شود: فعالیت‌های امروز خودش.)
4. چیدمان: سه ستون (چپ: ویجت‌های شخصی، وسط: اپ‌ها، راست: ویجت‌های مدیریتی و گزارش) و کل عرض صفحه؟ (بله. در موبایل یک ستون.)
5. ادمین بتواند یک چیدمان پیش‌فرض برای کل شرکت ذخیره کند که کاربران جدید با آن شروع کنند؟ (بله، در همین فاز.)
6. کاشی اپ‌ها قابل حذف از صفحه اصلی باشد؟ (خیر؛ جابجا می‌شود ولی حذف نمی‌شود، چون تنها راه رسیدن به ماژول‌هاست.)

```text
Before starting, check the list of available skills. Use every skill that fits this task.
At the end, say which skills you used, or that none fit.
This task is mostly visual: use the design and motion skills (for example frontend-design and the
motion-graphics skill) for every widget, so the home looks polished in light and dark.

Task: turn the home page of the new UI into a customisable widget dashboard, and make sales and
financial figures visible to admins only. Branch: saas/home-widgets. Open a draft PR.

Today: with the new shell active, src/app/page.client.tsx renders the App Launcher
(src/app/apps/page.client.tsx, max-w-5xl, so the left and right of wide screens are empty).
Launcher tiles show live figures from src/app/api/shell/kpis/route.ts (sales this month in AZN,
number of sales, sum of account balances) to ANY user whose RLS lets them read those tables.
The old dashboard (ManagementDashboardPage, same file) shows revenue/expenses/profit to anyone with
can_view_dashboard. Roles: "Admin" and "Manager" are system roles (src/types/database.types.ts),
isAdminRole() in the app, public.user_is_admin() in SQL; resolvePermissionPath() always returns
true for admins (src/lib/auth/permissionMatrix.ts).

Rule for this task: "financial widget" = any figure with money amounts or sales/purchase counts
(sales, purchases, revenue, expenses, profit, cash/bank balances, receivables, payables, inventory
value, targets, pipeline value). Only users with permission dashboard.view_financials see them;
admins always have it, nobody else has it by default. Enforce it on the server and in the
database, never only by hiding UI.

Steps:

1. Close the current leak (ships without a flag, it only removes figures):
   - Add permission dashboard.view_financials ("View financial figures on the home page") to the
     dashboard module manifest so it appears in the role matrix (src/modules, buildPermissionMatrix).
     Add a helper canViewFinancials(profile) in src/lib/auth next to userHasGranularPermission.
   - /api/shell/kpis: compute dashboard (sales total), trade (sales count) and finance (balances)
     only when canViewFinancials is true; otherwise do not run those queries and return no figure
     for them. For non-admins the trade tile shows the user's own activities due today instead.
   - ManagementDashboardPage: render the money KPI cards, the monthly trend and recent transactions
     only for canViewFinancials; the low stock panel stays for everyone with inventory access.
   - Unit tests for both (admin sees, Manager and custom role do not, override grant does).

2. Database (two migration files, check `ls supabase/migrations` and open PRs for free prefixes;
   20261025100000 is taken by the CRM PR #63, so start at 20261025110000):
   a) home_layouts: one row per user (user_id pk default auth.uid(), layout jsonb with size check
      like view_favorites, updated_at), RLS own row only; plus tenant default layout: a row in
      company settings or a home_layout_defaults table (single row) readable by all authenticated,
      writable only when public.user_is_admin(). Safe to re-run; only the new home reads it.
   b) home_financial_summary(p_from date, p_to date) and any other aggregate RPCs the financial
      widgets need: security definer, `set search_path = public`, first line raises 'forbidden'
      unless public.user_is_admin() or the user's role grants dashboard.view_financials. Do the
      sums in SQL (the sales loader caps at 1,000 rows, so never add up rows in the browser).
      Exclude cancelled/void/draft documents the same way src/lib/shell/kpis.ts does.
   Test both migrations on a local or branch database, never on production. In the PR say which
   file Del runs first.

3. Widget framework (src/lib/home/ for pure logic, src/components/home/ for UI):
   - A typed registry: id, title i18n key, category (personal | operations | management), allowed
     sizes (S = 1 column cell, M, L = full column width with chart), required module
     (useEnabledModules), required permission path, financial: boolean, default column and order.
   - Pure functions with tests: sanitizeLayout(layout, user context) drops unknown widgets,
     widgets of disabled modules, widgets the user may not see, and duplicates; mergeWithDefaults
     (user layout -> tenant default -> built-in default); moveWidget(layout, id, column, index).
   - Data: GET /api/home/widgets/[id] runs the widget's loader with the user's own Supabase
     session and returns 403 for a financial widget when canViewFinancials is false. Each widget
     loads on its own (Skeleton while loading, EmptyState on no data, error card on failure) so
     one slow widget does not block the page. Refresh on focus and every 60 s, like the old page.
   - Put the whole new home behind a NEW_HOME flag in src/lib/features (default off, audience
     admins|all like NEW_UI_AUDIENCE). With NEW_HOME off, the launcher stays exactly as today.

4. Layout and editing:
   - Full width (remove max-w-5xl on the home only). xl and up: three columns (start 3/12,
     centre 6/12, end 3/12; use logical start/end, not left/right).
     md: two columns. Mobile: one column in the saved order.
   - Default layout: start column = personal widgets, centre = Apps (the existing AppGrid, pinned:
     movable but not removable) + Quick actions, end column = management widgets for users who
     may see them, operations widgets for everyone else.
   - A "Customise" button switches to edit mode: drag handle on each widget (motion Reorder per
     column; moving to another column through the widget menu and by dragging between columns),
     remove (x), size picker, "Add widget" panel (Radix Dialog as a side sheet) listing only
     widgets the user may add, grouped by category, with a small preview. Save, Cancel, Reset to
     default. Admins also get "Save as company default".
   - Keyboard: every move is possible without a mouse (Move up / Move down / Move to column in
     the widget menu), with aria-live announcements. Respect prefers-reduced-motion through
     motionPreset() from src/design-system/motion.ts.
   - References: dashboards/dashboards-sidebar-stat-cards, dashboards/dashboards-kanban-board-with-drag-and-drop
     (drag feel only), dashboards/dashboards-analytics-overview-with-range-chips,
     dashboards/dashboards-chart-card-with-legend, dashboards/dashboards-activity-feed-panel,
     dashboards/dashboards-approvals-queue-with-detail-drawer, dashboards/dashboards-week-schedule-grid,
     dashboards/dashboards-inventory-replenishment-cockpit, stats/stats-metric-cards-with-sparkline-bars,
     stats/stats-four-metric-row, stats/stats-goal-progress-bars, stats/stats-conversion-funnel-steps,
     stats/stats-leaderboard-with-rank-movement, stats/stats-week-over-week-delta-table,
     stats/stats-count-up-metrics-on-view, stats/stats-ring-gauge-trio. Reuse MetricCard, ChartCard,
     RingGauge, FunnelSteps, GoalProgress, CountUp, Skeleton and EmptyState from src/design-system
     before building anything new.

5. Widgets. Build every widget whose data exists on main; for a widget whose module or table is
   missing (e.g. CRM targets before PR #63 merges), register it but keep it hidden, and list it in the PR.
   Personal (everyone, filtered by module and permission):
   - Greeting with today's date and the company name.
   - Clock: large live time (Asia/Baku by default, from the company profile when it has a time zone),
     date in the user's locale, optional analogue face; size S or M.
   - Calendar: month grid with today highlighted and dots on days that have the user's events or
     due activities (calendar module when enabled, a plain month grid otherwise); click a day opens
     that day in the calendar.
   - Weather: current temperature, condition icon and a 3-day forecast for the company city
     (default Baku; the user can pick another city in the widget settings). Fetch on the server
     from Open-Meteo (no API key, no personal data sent), cache 30 minutes per city, show the
     last value with its time if the fetch fails. Draw our own icons with lucide, no external images.
   - Quick actions: new sale, new purchase, new customer, new task, new expense (only the ones the
     user may create).
   - My activities: overdue / today / planned, click opens the record.
   - Today's agenda from the calendar.
   - My to-dos (due today and overdue, tick to finish).
   - Pending approvals assigned to me (expenses today; other approval types when they exist).
   - Saved views (view_favorites) as shortcuts.
   - Recent documents.
   Operations (no money amounts):
   - Low stock list with "reorder" link.
   - Open production orders by status.
   - Who is away today (HR leaves).
   - My CRM pipeline: number of my deals per stage.
   Management (financial, dashboard.view_financials only):
   - Sales this month with delta vs last month and a sparkline (sales count shown here, not on tiles).
   - Revenue vs expenses trend with range chips 30 d / 90 d / 12 m.
   - Net profit this month.
   - Purchases this month.
   - Cash and bank balances per account (respect allowed_financial_accounts scope).
   - Receivables with ageing buckets (0-30, 31-60, 61-90, 90+) and top debtors.
   - Payables due in the next 14 days.
   - Top 5 customers and top 5 products by revenue (leaderboard with rank movement).
   - Sales by salesperson this month.
   - Expenses by category this month.
   - Inventory value (stock x cost; sheet products are stored in metres, use the per-metre cost).
   - Week-over-week table: sales, purchases, expenses, new customers.
   - Sales target progress and pipeline value funnel (hidden until CRM targets exist).
   - Customer balance discrepancy alert (move the existing AR warning here).
   All amounts in AZN with formatFigure; counts animate with CountUp.

6. i18n: every string (widget titles, empty states, edit mode, permission label) in az, en, ru.

7. Tests: registry/sanitize/merge/move unit tests; API test that a non-admin gets 403 on every
   financial widget and that the RPC raises forbidden; component test that a Manager's default
   layout contains no financial widget. Then npm run lint, npm test, npm run build.

Rules: no Odoo code or texts; no SQL on production; NEW_HOME off by default; step 1 is the only
behaviour change visible after merge. Keep the PR on this task; list unrelated problems in the PR.

PR description: what changed in plain words, screenshots of the home as Admin and as a non-admin
user (light and dark, desktop and mobile), how it was tested, and the manual steps for Del in order:
run migration a, run migration b, set NEW_HOME=true and NEW_HOME_AUDIENCE=admins on the server,
check, then NEW_HOME_AUDIENCE=all.

Done when: an admin sees and arranges sales/finance widgets; a non-admin never receives a money
figure from any page or API on the home (checked in the network tab); every user can add, remove,
resize and move widgets with mouse and keyboard, and the layout survives reload and another device.
```

---

### پرامپت ۲۴ج: انتخاب ستون در لیست فاکتورها و سندها، و ستون‌های تاریخ و کاربر

**درخواست Del (۲۰۲۶-۱۰-۲۸، مورد ۶):** در لیست فاکتورها و سندها بتوان ستون اضافه یا کم کرد. همه جا ستون‌های تاریخ صدور سند، تاریخ فاکتور، نام فروشنده و نام کاربر سازنده سند نشان داده شود.

**وضعیت امروز (بررسی کد، ۲۰۲۶-۱۰-۲۸):**
- هر لیست دو نسخه دارد: UI قدیمی (مثلاً `SalesPage.tsx`، `PurchasesPage.tsx` با ستون‌های ثابت) و UI جدید روی موتور View (`src/views/components/ListView.tsx` که فقط `def.list.columns` ثابت را نشان می‌دهد). هیچ‌کدام انتخاب ستون ندارند. تنها نمونه موجود، صفحه محصولات قدیمی است (`ColumnVisibilityPanel` و `src/lib/products/columns.ts`، ذخیره در localStorage).
- «تاریخ فاکتور» همان `doc_date` است که کاربر انتخاب می‌کند (و با مورد ۴، تاریخ قبل هم مجاز می‌شود). «تاریخ صدور سند» زمان واقعی ثبت در سیستم است (`created_at`). بعد از مجاز شدن تاریخ قبل، این دو ستون با هم فرق دارند و هر دو لازم‌اند.
- فاکتور فروش: `seller_id`/`seller_name`، `issued_by` و `created_by` در جدول هست؛ ولی نام سازنده فقط در صفحه جزئیات خوانده می‌شود، نه در لیست.
- فاکتور خرید: ستون `created_by` ندارد؛ فقط `responsible_id`/`responsible_name`. برای سندهای قدیمی سازنده را می‌شود از `audit_logs` (اگر insert ثبت شده) پیدا کرد، وگرنه «—».
- سندهای دیگر: `warehouse_slips`، `payments`، `transactions` ستون `created_by` دارند؛ برای بقیه (هزینه‌ها، انبارگردانی، موجودی اولیه، ضایعات، امانی، انتقال) Claude Code باید بررسی کند.

**تصمیم‌هایی که پیشنهاد شده (اگر Del مخالف بود قبل از اجرا عوض شود):**
1. انتخاب ستون‌ها برای هر کاربر جدا و روی همان مرورگر ذخیره شود (localStorage، مثل صفحه محصولات). نیازی به جدول جدید نیست.
2. چهار ستون جدید به‌طور پیش‌فرض روشن باشند، ولی کل قابلیت پشت فلگ `LIST_COLUMNS` (پیش‌فرض خاموش) برود تا Del اول خودش ببیند و بعد روشن کند.
3. «فروشنده» در فاکتور خرید معنی ندارد (تأمین‌کننده جداست)، پس آنجا ستون «مسئول» نشان داده شود. در سندهای امانی ستون `sales_rep_name`.

```text
Before starting, check the list of available skills. Use every skill that fits this task.
At the end, say which skills you used, or that none fit.

Task: let users show/hide columns in every invoice and document list, in both the classic UI
and the new UI (view engine), and add four standard columns everywhere: Issued at (when the
document was created in the system), Invoice/document date, Salesperson, Created by.
Branch: saas/list-columns. Open a draft PR.

Today:
- Classic lists have fixed <Th> columns: src/modules/sales/components/SalesPage.tsx,
  src/modules/purchases/components/PurchasesPage.tsx and the other list pages listed below.
- New UI lists use src/views/components/ListView.tsx, which renders def.list.columns only
  (src/views/types.ts ListViewDef). Definitions: src/modules/*/views/*.ts.
- The only column picker is the classic products page: src/components/products/ColumnVisibilityPanel.tsx
  + src/lib/products/columns.ts (localStorage). Generalise it, don't copy it.
- sales has created_by, issued_by, seller_id, seller_name, created_at, doc_date. Creator and issuer
  names are resolved only in fetchSaleById (src/modules/sales/lib/fetchSales.ts), not in the list.
- purchases has no created_by column; it has responsible_id/responsible_name, created_at, doc_date.
- warehouse_slips, payments, transactions have created_by. Check every other document table.

Definitions (use them in every list):
- "Issued at" = created_at (date and time, in the user's locale). Not editable.
- "Document date" = the business date of the document (doc_date, payment_date, transaction_date,
  expense_date, count_date, writeoff_date...). Label it "Invoice date" on invoices.
- "Salesperson" = sales: issued_by name, else seller_name (same rule as mapSaleToInvoicePrint);
  purchases: responsible_name with the label "Responsible"; consignment: sales_rep_name.
  Lists that have no such person: leave the column out of that list.
- "Created by" = the profile name of created_by. Never show a raw uuid; unknown -> "—".

Steps:

1. Shared column model (src/lib/lists/columns.ts, pure, with unit tests):
   - ListColumnDef { key, labelKey (i18n), defaultVisible, required?: boolean (cannot be hidden,
     e.g. document number), numeric?: boolean }.
   - loadColumnPrefs(listKey, userId, defs) / saveColumnPrefs(...): localStorage key
     `${PRODUCT_SLUG}-cols-${listKey}-${userId}`, stores visible keys AND order; unknown keys are
     dropped, new columns appear with their defaultVisible, required columns are always visible,
     at least one column stays visible. try/catch around every storage call (private mode).
   - resetColumnPrefs. Move src/lib/products/columns.ts onto this model without changing what the
     products page shows.

2. One picker component (src/components/lists/ColumnPicker.tsx), used by classic and new UI:
   Radix Popover (or DropdownMenu with checkbox items) from a "Columns" button with the Columns3
   icon, a checkbox per column, drag handle or Move up/Move down to reorder (motion Reorder,
   motionPreset() for reduced motion), "Reset to default". Keyboard accessible, aria labels, RTL
   safe (use start/end), light and dark via design tokens. Reference for the look only:
   any table/settings popover under docs/ui-library/vibeprompts/ that fits; do not paste its JS.

3. New UI (view engine):
   - Extend ListViewDef with optional `optional?: readonly string[]` (extra columns the user may
     turn on, off by default) and keep `columns` as the default visible set.
   - ListView: render the user's visible/ordered columns; the picker sits at the end of the header
     row (like an "optional columns" toggler). Group rows, sums row and sorting must keep working
     with any column set. Persist per view key (SALES_VIEW_KEY, PURCHASES_VIEW_KEY, ...) with the
     column model from step 1. Also store the column set inside a saved favourite's state
     (view_favorites.state already is jsonb), so a saved view brings its columns back; old
     favourites without columns use the user's prefs.
   - Add fields to the definitions where missing: created_at ("Issued at"), created_by_name
     ("Created by"), the salesperson field. Every field in a definition should be available in the
     picker unless it is internal.

4. Classic UI: in each list page below, replace the fixed <Th>/<Td> pairs with a column array
   (key -> header, cell renderer, numeric) filtered by the prefs, so header, body, skeleton
   column count and CSV export follow the same visible set. Keep the select checkbox and actions
   column fixed. Keep the current columns as the default set plus the four new ones.

5. Data:
   - Sales list: add created_by and issued_by names to fetchSalesListWithMeta in ONE batched
     profiles lookup for the page (no per-row query). If RLS on profiles stops non-admins from
     reading other users' names, add a small security definer RPC
     profile_display_names(p_ids uuid[]) returning (id, full_name) only, set search_path = public,
     for authenticated users. Same helper for every list.
   - Purchases: migration adding purchases.created_by uuid references auth.users default auth.uid(),
     plus a BEFORE INSERT trigger that forces created_by := auth.uid() when auth.uid() is not null
     (like sales_invoice_issuer_audit). Backfill old rows from audit_logs (table_name='purchases',
     action insert, record_id) where such rows exist; leave the rest null ("—"). Check the purchase
     submit RPC still works. Same for any other document table that lacks created_by and is
     listed below; one migration file per table change.
   - Migration prefixes: check `ls supabase/migrations` and the open PRs first (PR #65 uses
     20261025110000+, PR #66 uses 20261028130000, PR #68 uses 20261028181000 and 20261028182000).
     Use 20261028140000 (and 20261028141000, 142000... if more files are needed).
     Test on a local or branch database, never on production.

6. Lists in scope (classic + new UI each; skip a list that does not exist and say so in the PR):
   sales invoices, purchase invoices, sales returns / purchase returns if they exist, payments
   (PaymentsPage), finance transactions (FinancePage, accounting views), cash/bank documents,
   expenses, warehouse slips, stock transfers, inventory counts, initial balances, damaged goods /
   write-offs, consignment documents, contracts. Products keep their own columns (step 1 only).

7. Feature flag: LIST_COLUMNS in src/lib/features (default off). Off = every list looks exactly as
   today (no picker, no new columns). On = picker + the four columns visible by default.

8. i18n: every label (Columns, Reset to default, Issued at, Invoice date, Document date,
   Salesperson, Responsible, Created by, Move up/down) in az, en, ru.

9. Tests: column model (merge with new defs, required columns, order, corrupted storage), ListView
   renders the chosen columns and sums still match, classic SalesPage header/body column counts
   match, salesperson/creator name resolution, migration trigger sets created_by. Then
   npm run lint, npm test, npm run build.

Rules: no Odoo code or texts; no SQL on production; flag off by default; keep the PR on this
task and list unrelated problems in the PR (for example the 1,000-row sales loader cap).

PR description: what changed in plain words, screenshots of the sales and purchases lists with the
picker open (classic and new UI, light and dark), how it was tested, and Del's manual steps in
order: run the migration file(s) on production in the listed order, set LIST_COLUMNS=true on the
server, check the lists.

Done when: on every list in scope a user can hide, show and reorder columns, the choice survives a
reload, and Issued at, Invoice/document date, Salesperson (where it applies) and Created by show
real names and dates, also for documents created before this change where the data exists.
```

---

## فاز ۷: آماده‌سازی فروش

### پرامپت ۲۵: سایت معرفی، ثبت‌نام و شرکت دمو

```text
Task: marketing site and self-service trial.

Do:
- A public site (in control-panel/ under the root domain): hero, features, module catalogue, pricing with
  module/user calculator, FAQ, testimonials placeholder, contact/demo booking, legal pages (terms,
  privacy, DPA). Use vibeprompts.dev hero, features, pricing, faq, cta, footer and contact categories as
  references; az/en/ru.
- Trial sign-up (auth/auth-trial-signup-with-plan-summary as reference) -> provisioning job -> onboarding
  wizard in the new tenant (onboarding/* pages as references), with "sample data or your own" choice.
- A demo tenant with realistic fake data (never Del Groups data), reset nightly.

Done when: a visitor can sign up, get a trial ERP with sample data and see pricing that matches the plans in the control panel.
```
