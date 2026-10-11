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
