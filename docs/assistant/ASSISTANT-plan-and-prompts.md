# Del Assistant: one active AI colleague for the whole ERP

Plan and Claude Code prompts AST-1 … AST-6. Written 2026-11-14 (Opus 5.5) from Del's decisions in the project thread.

## خلاصه برای Del

یک دستیار واحد برای کل ERP، با Claude، که:
- **همه‌جا هست**: یک پنل کناری با آواتار متحرک، هماهنگ با سیستم طراحی؛ از هر صفحه با یک کلید باز می‌شود و می‌داند کاربر روی کدام صفحه و کدام سند است.
- **با دسترسی همان کاربر** کار می‌کند: هر چه کاربر می‌تواند ببیند، دستیار هم می‌بیند؛ نه بیشتر.
- **فعال است**: وقتی کارمند سند پر می‌کند و اشتباه می‌کند (قیمت زیر بها، مالیات غلط، موجودی منفی، تکرار فاکتور، تاریخ دورهٔ بسته…)، همان لحظه آواتار هشدار می‌دهد و دکمهٔ «اصلاح کن» نشان می‌دهد. این بررسی‌ها اول با قانون‌های سریع و رایگان انجام می‌شود، Claude فقط برای توضیح و موارد غیرعادی.
- **کار انجام می‌دهد**: سند را به‌صورت **پیش‌نویس** می‌سازد؛ ثبت نهایی همیشه با کلیک خود کاربر.
- **حافظه دارد**: شرکت، مشتری‌ها، و هر کارمند (نقش، کارهای تکراری، اشتباهات رایج، ترجیحات) را به خاطر می‌سپارد. **فقط ادمین** حافظه را می‌بیند، ویرایش و حذف می‌کند؛ کارمندان فهرست حافظه را نمی‌بینند (تصمیم Del).
- **برای مدیریت تحلیل می‌دهد**: گزارش صبحگاهی، روند فروش، بدهکاران، ریسک انبار، پیشنهادهای فروش و بازاریابی.
- **حسابدار گارد** یکی از مهارت‌های همین دستیار می‌شود و فرم «سؤال از حسابدار» حذف می‌شود.

شش مرحله، هر کدام یک برنچ و PR، همه پشت فلگ `ASSISTANT_V2` و اول فقط برای ادمین. ترتیب: AST-1 هسته → AST-2 رابط و آواتار → AST-3 حافظه → AST-4 پیش‌نویس سند → AST-5 نظارت زنده → AST-6 تحلیل مدیریتی.

---

## 1. What exists today (and what we keep)

| Piece | Where | Fate |
|---|---|---|
| Native Claude agent loop with tools, router (Haiku / Sonnet / Opus), cost | `src/lib/ai/native/{agent,tools,router,store,config}.ts`, `/api/ai/agent` | **Kept and extended**: the one engine of the new assistant. `runNativeAgent` already accepts an injected client, toolset and limits (GUARD-5). |
| Read tools (products, stock alerts, customers, debtors, sales, finance summary, production) | `src/lib/ai/native/tools.ts` | **Kept**, moved into skills; each still checks the app permission and runs with the user's own Supabase client (RLS). |
| Conversations and usage | `ai_conversations`, `ai_messages`, `ai_usage_log` (20261005140000) | **Kept**; one conversation store for everything. |
| Old widget (n8n bridge, simple chat, agent picker) | `src/components/ai/AiAssistantWidget.tsx`, `src/lib/ai/{agents,complete,n8n*}.ts` | **Replaced** behind the flag; the old one stays when the flag is off. |
| Accounting Guard agent: read-only tools, memory, reports, suggestions, router, budget | `src/lib/guard/agent*.ts`, `guard_agent_memory`, `guard_ai_usage` | **Becomes the "accountant" skill.** The Reports tab keeps the saved reports; the "Ask the accountant" form goes away (the chat replaces it). Guard memory is migrated into the new memory. |
| Draft documents | `save_sales_invoice_draft` / `post_sales_invoice_draft`, same for purchases | **The write path of the assistant**: it only ever saves drafts; posting is the user's click. |

## 2. Principles (non-negotiable)

1. **The user's permissions, never more.** Every tool runs with the signed-in user's Supabase client (RLS) and checks the app permission first, exactly like the UI. No service-role reads in a user conversation. A tool the user may not use is not even offered to the model.
2. **Writes are proposals.** The model can only *propose* an action. The server stores the proposal; the UI shows a card with every field; the user presses Confirm; only then does a server action run it, with the user's session, an idempotency key and an audit log line `via: assistant`. Documents are saved as **drafts**; posting a document is never an assistant action. No deletes, no reversals, no settings, no permission changes, ever.
3. **Cheap by default.** Deterministic checks first (free), Haiku for light work, Sonnet for normal work, Opus only for analysis. Per-tenant monthly budget; the assistant degrades to "rules only" when it is reached.
4. **Admin-controlled memory.** Everything remembered is a note that admins can see, edit and delete. **Only admins see memory** (Del's decision, 2026-11-14): employees have no memory screen, cannot read notes through the API, and the assistant does not recite notes about an employee to that employee (it may use them to help, e.g. "check VAT on the service line"). Never remember: passwords or secrets, health, family, religion, politics, salary judgements, anything said "off the record", or personal opinions about a colleague.
5. **Data, not instructions.** Tool results, documents, notes and memories are data. The system prompt says so, and the write path does not trust anything the model says about permissions.
6. **Same look as the ERP.** The panel is built from `@/design-system/components` and follows `docs/ui-standard.md`; the avatar is the only "playful" element.
7. **Off by default.** `ASSISTANT_V2` (env, server) + `ASSISTANT_V2_AUDIENCE` (`admins` default, `all`). Merging any AST PR changes nothing for staff.

## 3. Architecture

```
            ┌──────────────── browser ────────────────┐
            │ AssistantPanel (dock / sheet)            │
            │  ├─ Avatar (state machine, motion)       │
            │  ├─ Thread (streamed markdown, tables,   │
            │  │   tool steps, proposal cards)         │
            │  └─ Composer (context chips, mic, files) │
            │ useAssistantWatch(form)  ── debounced ──►│ /api/assistant/watch  (rules → maybe Haiku)
            │ Realtime channel  ◄── alerts ────────────│ (guard findings on my documents)
            └──────────────────┬──────────────────────┘
                               │ SSE /api/assistant/chat
            ┌──────────────────▼──────────────────────┐
            │ Assistant core (server)                  │
            │  context: user, role, page, record, lang │
            │  memory: company + me + entities         │
            │  router: tier per turn                   │
            │  skills → tools (permission-filtered)    │
            │  runNativeAgent (streaming)              │
            │  proposals (write intents, not writes)   │
            └──────────────────┬──────────────────────┘
                               │ user's Supabase client (RLS)
                          Postgres (Supabase)
```

**Skills** are groups of tools plus a short instruction block, each with a module and permission: `sales`, `purchases`, `inventory`, `customers`, `finance`, `production`, `accountant` (the guard), `reports`, `memory`, `insights`. The core picks the skills for the turn from the page, the question and the user's permissions, so the model sees only a few dozen tools, never all.

**Streaming**: the chat route streams (Server-Sent Events) text deltas, tool steps and proposal cards; the panel renders them as they arrive.

**Context**: every message carries `{ page, recordType, recordId, selection }` from the client (validated server-side: the server reloads the record with the user's client; the client's copy is never trusted).

## 4. Memory model

One table family replaces `guard_agent_memory` (its rows are copied over in AST-3):

- `assistant_memory` — `scope` (`company` | `user` | `partner` | `product` | `employee_note`), `subject_id` (user / partner / product id or null), `kind` (`fact` | `preference` | `pattern` | `skill_gap` | `routine`), `subject` (unique per scope + subject_id), `body`, `source` (`assistant` | `admin` | `user`), `confidence` (0–1), `evidence` (jsonb: conversation / document ids), `last_used_at`, `expires_at`, timestamps.
- RLS: **admins only** read the table and write through `assistant_memory_save` / `_delete` (SECURITY DEFINER, validated, capped, audited). For a non-admin's turn the server calls `assistant_memory_for_turn(p_record_type, p_record_id)` (SECURITY DEFINER): it returns only company notes, the caller's own notes and notes of the record in context that the caller can read, and is used only to build the prompt, never returned to the browser. A non-admin's `remember` goes through the same validated function (own `user` notes and records they can read).

What it learns about an employee (examples, visible to admins only): role and the modules they use; routines ("enters supplier invoices on Mondays"); frequent customers and products; preferred language and report format; recurring mistakes and the fix that worked ("often forgets VAT on service lines"); questions they ask repeatedly. **How**: (a) at the end of a conversation a Haiku pass proposes at most 3 notes; (b) a nightly job digests the day's `audit_logs` per user into routine and mistake notes (no LLM for counting; Haiku only to phrase the note); (c) admins and users can add "remember that …" in chat.

Retrieval: before each turn the core loads the user's notes, company notes, and notes of the record in context (by subject); at most ~2 000 tokens, newest and most-used first. No vector database in v1 (Postgres full-text on `subject || body` is enough at this size; revisit at > 5 000 notes).

## 5. Active watch (the "pop up while I type" part)

Two layers, so it is instant and almost free:

1. **Rules in the browser and server (no LLM).** A pure TypeScript module `src/lib/assistant/watch/rules.ts` takes a normalised draft (`DocumentDraft`: type, date, partner, lines with product, qty, unit, price, discount, VAT, account, warehouse) plus a small context fetched once per form (`WatchContext`: cost and last price per product, stock per warehouse, partner credit limit and balance, closed period date, VAT setup, recent numbers). It returns `WatchIssue[]` with `{ code, severity, lineIndex, message key, params, fix?: DraftPatch }`. First rules (each mirrors a guard rule so "before save" and "after save" agree): price below cost (B6), VAT rate/amount mismatch (B1/B2), quantity above available stock, negative line, duplicate supplier invoice number (B8), date in a closed period, date in the future, partner over credit limit, price far from this customer's usual price (> X %), unit mismatch, missing account on a cash line, rounding difference in totals.
2. **Claude only when useful.** When the user opens an issue ("why?") or when the draft is unusual in a way rules cannot say (rare product for this customer, quantity 10× the usual), a debounced call to `/api/assistant/watch` sends the draft summary to Haiku with the relevant memory ("this employee often forgets VAT on service lines"). Rate-limited per user (e.g. 1 call / 20 s per form), cached by draft hash, counted in the budget.

The avatar reacts: calm → `attention` (amber pulse) for a warning, `alert` (red, small shake once) for an error. The panel does not open by itself; a small bubble next to the avatar says the first issue in one line with **Fix** / **Why** / **Ignore**. Fix applies the `DraftPatch` through the form's own setter (the form stays the source of truth; the assistant never writes to the database here). Ignoring three times the same code in a session silences it for that form. Every shown, fixed and ignored issue is logged (`assistant_watch_events`) so the nightly job can learn which rules help and which annoy.

After save, the existing guard incremental scan already runs; AST-5 pushes new findings on a document to its author through Supabase Realtime, so the avatar can say "the document you just saved has a problem".

## 6. Avatar

A single SVG character drawn in our tokens (no external assets, no Lottie, no copyrighted characters): a soft rounded "spark" shape with two eyes, built with the `motion` library already in the repo.

States (one state machine, `useAvatarState`): `idle` (slow breathing scale 1 → 1.03, eyes blink every 4–7 s at random), `listening` (eyes follow the caret side, slight lean), `thinking` (three orbiting dots), `speaking` (gentle bounce synced to streamed tokens), `attention` (amber glow pulse), `alert` (red, one 300 ms shake), `success` (eyes become arcs, small hop), `sleeping` (budget reached / off). `prefers-reduced-motion`: no loops, only colour changes. Sizes: 28 px in the header button, 40 px in the panel header, 56 px in the empty state. Accessible: `role="img"` with a label that says the state ("Assistant is thinking").

## 7. Costs

| Task | Tier | Rough cost |
|---|---|---|
| Watch rules | none | free |
| Watch "why" / unusual draft | Haiku | < 0.002 USD |
| Ordinary chat turn with 1–3 tools | Haiku or Sonnet (router) | 0.002 – 0.03 USD |
| Proposal (draft document) | Sonnet | ~0.02 USD |
| Analysis question / morning briefing | Opus for analysis, Sonnet for briefing | 0.05 – 0.30 USD |
| Nightly memory digest | Haiku | ~0.01 USD per active user |

`ASSISTANT_MONTHLY_BUDGET_USD` (default 30) per tenant; guard budget stays separate. Prompt caching on the system prompt + tool definitions (stable order) as the existing loop does.

## 8. Order and branches

| # | Branch | What | Migration |
|---|---|---|---|
| AST-1 | `saas/assistant-core` | Core: skills, permission-filtered tools, streaming chat route, context, flag, usage | `…_assistant_core.sql` (small: conversation context column, budget view) |
| AST-2 | `saas/assistant-ui` | Panel, avatar, thread, composer, shortcuts, mobile; old widget behind flag | none |
| AST-3 | `saas/assistant-memory` | Memory tables, learning, "what I know about you", admin page; guard memory migrated | `…_assistant_memory.sql` |
| AST-4 | `saas/assistant-actions` | Proposals and confirm flow; draft sale / purchase / payment / expense / customer | `…_assistant_actions.sql` |
| AST-5 | `saas/assistant-watch` | Rules, watch hook on forms, avatar alerts, realtime guard alerts | `…_assistant_watch.sql` |
| AST-6 | `saas/assistant-insights` | Morning briefing, sales and marketing suggestions, accountant skill, remove the guard ask form | none or small |

Pick migration timestamps after the last file in `supabase/migrations` when each task starts (rule 3 of CLAUDE.md).

---

# Prompts

Every prompt below starts with the same line and follows `CLAUDE.md` (branch per task, never push to main, one migration per DB change, never run SQL on production, flag off by default, `npm run lint` / `npm test` / `npm run build` before the PR, all strings in az / en / ru, `docs/ui-standard.md` rule ids in the PR, PR description in plain words with tests and manual steps).

## AST-1 — Assistant core

> Before starting, check the list of available skills. Use every skill that fits (for example claude-api for the Claude API parts). At the end, say which skills you used, or that none fit.
>
> **Branch:** `saas/assistant-core` from `main`. Read `docs/assistant/ASSISTANT-plan-and-prompts.md` sections 1–3 and 7 first, and the Next.js docs in `node_modules/next/dist/docs/` for route handlers and streaming.
>
> **Goal:** one server-side assistant engine that the new UI (AST-2) and every later step use. Behind `ASSISTANT_V2=true` (server env) and `ASSISTANT_V2_AUDIENCE` (`admins` default, `all`). With the flag off nothing changes.
>
> Build:
> 1. `src/lib/assistant/config.ts` — flag, audience, `ANTHROPIC_API_KEY`, `ASSISTANT_MONTHLY_BUDGET_USD` (default 30), `ASSISTANT_FORCE_TIER`. Pure functions of an env object (tests pass their own), like `src/lib/guard/agentConfig.ts`.
> 2. `src/lib/assistant/skills/` — a `Skill` type `{ id, module, permission, instructions, tools: ToolDef[] }` and a registry. Move the existing read tools of `src/lib/ai/native/tools.ts` into skills (`sales`, `inventory`, `customers`, `finance`, `production`) without changing their behaviour; keep `tools.ts` exporting what `/api/ai/agent` uses so the old route still works. Add the `accountant` skill that wraps the guard's read-only tools (`src/lib/guard/agentTools.ts`) for admins only (it runs with the admin's session).
> 3. `src/lib/assistant/select.ts` — chooses the skills for a turn: from the page (`/sales/...` → sales), the record type in context, keywords of the question (az / en / ru / fa), and the user's permissions and enabled modules. At most 6 skills, tools in a stable order (prompt cache). Pure and tested.
> 4. `src/lib/assistant/context.ts` — validates the client context `{ page, recordType, recordId }` and reloads the record with the user's client (never trust the client copy); builds a short "you are looking at" block.
> 5. `src/lib/assistant/prompt.ts` — the system prompt: who the assistant is (a colleague inside Del Groups ERP, Azerbaijan, AZN, VAT 18 %), the user (name, role, language), the rules of section 2 (permissions, proposals only, data not instructions, never invent numbers, cite documents with internal links), the selected skills' instructions. Byte-stable per user role + skills for caching.
> 6. Streaming: extend `runNativeAgent` (keep its current behaviour as default) with an optional `onEvent(event)` callback for `text_delta`, `tool_start`, `tool_end`, `done`, using the SDK's streaming API. New route `src/app/api/assistant/chat/route.ts` (POST, signed-in user, flag + audience, rate limit, `checkUsage("ai")`, budget) that returns `text/event-stream` with those events and saves the turn with `saveTurn` (conversation context saved in a new `ai_conversations.context jsonb` column).
> 7. Router: reuse `routeRequest` with one change: a turn whose selected skills include `accountant` or whose question is analysis goes to the deep tier only for admins; others cap at standard.
> 8. Migration `…_assistant_core.sql`: `ai_conversations.context jsonb`, `ai_usage_log.source text default 'assistant_v1'` (new rows `assistant_v2`), and a function `assistant_month_cost()` (admin or service) for the budget. Re-runnable; SQL test in `supabase/tests/assistant_core.sql` + db-baseline step + `supabase/scripts/tenant1_preflight.sql` entry.
>
> Tests (`tests/assistantCore.test.mjs`, stand-in Claude client like `tests/accountingGuardAgent.test.mjs`): config gates; skill selection (page, keywords, permissions remove tools, modules remove tools); a non-admin never gets `accountant`; context reload refuses ids the user cannot read; the SSE route sends deltas, steps and done; budget stops before calling Claude; the old `/api/ai/agent` still behaves the same.
>
> PR: what changed, tests, how to switch on (`ASSISTANT_V2=true`, audience), cost notes, and that no UI changes yet.

## AST-2 — The panel and the avatar

> Before starting, check the list of available skills. Use every skill that fits (frontend-design and design:ux-copy should fit). At the end, say which skills you used, or that none fit.
>
> **Branch:** `saas/assistant-ui` from `main` after AST-1 is merged. Read sections 2, 3 and 6 of `docs/assistant/ASSISTANT-plan-and-prompts.md`, `docs/ui-standard.md` (all of it) and the design-system components in `@/design-system/components`.
>
> **Goal:** the assistant's UI, behind `ASSISTANT_V2` (+ audience). With the flag on, the header assistant button opens the new panel instead of `AiAssistantWidget`; with it off, nothing changes.
>
> Build in `src/components/assistant/`:
> 1. **`AssistantAvatar.tsx`** — the SVG character of section 6 with `motion`: states `idle`, `listening`, `thinking`, `speaking`, `attention`, `alert`, `success`, `sleeping`; sizes 28 / 40 / 56; colours only from tokens (works in light and dark); `prefers-reduced-motion` respected; `role="img"` + state label. A small story page at `/settings/dev/avatar` (admins only, flag on) shows every state for review.
> 2. **`AssistantPanel.tsx`** — docked on the right on desktop (resizable 360–560 px, width remembered per user in localStorage with try/catch), a bottom sheet on mobile. Header: avatar 40, title, the current context chip ("Sale SS-2026-00123"), New chat, history, close. Uses the shell's layout so page content shrinks instead of being covered on wide screens.
> 3. **Thread** — streamed markdown (reuse `AiAssistantMarkdown`), tables with the standard table styles, tool steps as a collapsible "What I looked at" list, internal links only (`isSafeInternalHref`), copy button, retry, errors with the reason (budget, permission, network) in plain words.
> 4. **Composer** — textarea that grows to 6 lines, Enter sends / Shift+Enter new line, context chip that can be removed, suggestion chips for the page ("Unpaid invoices of this customer", "Why is this price low?"), mic (reuse the widget's recording), stop button while streaming.
> 5. **Empty state** — avatar 56, a one-line greeting with the user's first name and 3–4 suggestions from the page and role.
> 6. **History** — the user's conversations (from `ai_conversations`), rename, delete (soft), open.
> 7. **Shortcut** — `Ctrl+J` / `Cmd+J` toggles the panel; `Esc` closes; focus returns to the button (ui-standard accessibility rules).
> 8. Header button: the 28 px avatar replaces the sparkle icon when the flag is on; it shows the avatar state (thinking while a reply streams, attention when AST-5 later raises an issue).
>
> All strings in az / en / ru. Follow ui-standard rules for drawers, buttons (one primary: Send), toasts, focus, contrast, sizes. No native `<select>` (use Combobox). No raw colours.
>
> Tests: avatar state machine (pure reducer), panel open/close and shortcut logic, SSE parsing of the stream, link safety, i18n completeness, reduced-motion branch. Screenshot the panel and every avatar state in light and dark with Playwright at 1440 and 390 widths and attach them to the PR.
>
> PR: rule ids touched, screenshots, how to switch on, what the old widget does now.

## AST-3 — Memory

> Before starting, check the list of available skills. Use every skill that fits. At the end, say which skills you used, or that none fit.
>
> **Branch:** `saas/assistant-memory`. Read section 4 of the plan.
>
> **Goal:** the assistant remembers the company, each employee, customers and products; everyone can see what is remembered about them.
>
> Build:
> 1. Migration `…_assistant_memory.sql`: `assistant_memory` exactly as section 4 (scopes, kinds, unique subject per scope + subject_id, confidence, evidence, last_used_at, expires_at), RLS (user: company + own + records they can see; admin: all), `assistant_memory_save`, `assistant_memory_delete`, `assistant_memory_touch` (last_used_at), cap 5 000 rows, audit log on admin edits. Copy `guard_agent_memory` rows into `scope='company'` notes once (keep the old table; the guard skill reads the new one from now on). SQL test, CI step, preflight entry.
> 2. Memory skill tools: `remember` (scope chosen by the model but validated: a non-admin can only write `user` notes about themselves and `partner`/`product` notes on records they can read), `recall` (search by text and subject), no delete tool.
> 3. Retrieval in the core (AST-1 prompt builder): company + my notes + notes of the record in context, newest and most-used first, ≤ 2 000 tokens; mark used notes with `assistant_memory_touch`.
> 4. Learning: (a) after a conversation ends (no message for 10 minutes, or New chat), a Haiku pass proposes up to 3 notes with confidence; only ≥ 0.7 are saved. (b) Nightly (reuse the GitHub workflow pattern of `.github/workflows/accounting-guard.yml` with its own secret `ASSISTANT_CRON_SECRET`): per active user, count yesterday's `audit_logs` by action and module, detect routines (same action on the same weekday ≥ 3 weeks) and repeated corrections (a document edited within 10 minutes of saving, same field), and save them as `routine` / `skill_gap` notes (Haiku only phrases them).
> 5. The forbidden list of section 2.4 is enforced in code (a filter on subject/body with patterns in az / en / ru / fa) and in the prompt; a test proves forbidden notes are refused.
> 6. UI (admins only; Del decided employees do not see memory): an admin page `Settings → Assistant → Memory` with filters by scope / user / kind, edit, delete, the evidence links, and per employee a profile view of their notes. No memory screen for non-admins; the system prompt tells the assistant not to recite notes about an employee to that employee.
>
> Tests: RLS (a non-admin reads nothing from `assistant_memory`; `assistant_memory_for_turn` returns only company, own and readable-record notes; admin all), forbidden notes refused, retrieval budget, learning heuristics on fixtures, guard memory copied once.

## AST-4 — Doing work: proposals and drafts

> Before starting, check the list of available skills. Use every skill that fits. At the end, say which skills you used, or that none fit.
>
> **Branch:** `saas/assistant-actions`. Read section 2 (principle 2) of the plan.
>
> **Goal:** the assistant can prepare documents for the user, who confirms them. It never posts, deletes or reverses anything.
>
> Build:
> 1. Migration `…_assistant_actions.sql`: `assistant_proposals` (id, user_id, conversation_id, kind, payload jsonb, summary, status `proposed|confirmed|rejected|expired|failed`, result jsonb (created ids), idempotency key, created_at, decided_at), RLS: a user sees and decides only their own; expire after 24 h. SQL test, CI step, preflight.
> 2. Proposal tools (one per kind, typed input with zod-like validation in TS): `propose_sale_draft`, `propose_purchase_draft`, `propose_customer`, `propose_partner_payment`, `propose_expense`. Each validates against the user's permission and the same rules the form uses (reuse the form's validation functions; do not duplicate them), resolves names to ids with the user's client (asking back when ambiguous instead of guessing), and stores a proposal. The tool result tells the model "waiting for the user".
> 3. The panel renders a **proposal card**: every field as the document form shows it (customer, date, lines, totals with VAT), warnings from the AST-5 rules if present, buttons **Create draft** (primary), **Edit in form** (opens the real form prefilled through a URL state or session storage), **Cancel**.
> 4. Confirm runs a server action with the user's session that calls the existing draft RPCs (`save_sales_invoice_draft`, `save_purchase_invoice_draft`, payment / expense creation functions as the forms do), records the result, writes an audit line `via: assistant`, and replies in the thread with the link. Posting stays a button on the document itself.
> 5. Safety: the server re-checks the permission at confirm time; the payload the user sees is the payload that runs (hash compared); one confirm per idempotency key; amounts above a configurable limit (`ASSISTANT_CONFIRM_LIMIT_AZN`, default 10 000) need a second confirm.
>
> Tests: a user without sales create permission never gets the sale tool and cannot confirm a forged proposal; hash mismatch refused; double confirm creates one draft; ambiguous customer name leads to a question, not a guess; nothing is posted.

## AST-5 — Active watch

> Before starting, check the list of available skills. Use every skill that fits. At the end, say which skills you used, or that none fit.
>
> **Branch:** `saas/assistant-watch`. Read section 5 of the plan and the guard rules B1, B2, B6, B8 in `supabase/migrations/20261120100000_accounting_guard_core.sql`.
>
> **Goal:** while an employee fills a sales or purchase document (then payments and journal entries), the assistant warns at once and offers the fix.
>
> Build:
> 1. `src/lib/assistant/watch/rules.ts` — pure rules over `DocumentDraft` + `WatchContext` returning `WatchIssue[]` with optional `DraftPatch`. The rules of section 5, thresholds from `guard_rules.params` where the guard has the same rule (so before-save and after-save agree). 100 % unit-tested with fixtures.
> 2. `src/lib/assistant/watch/context.ts` + server action `loadWatchContext(docType, partnerId, productIds, warehouseId)` with the user's client (only what the user may read).
> 3. `useAssistantWatch(draft)` hook: debounced 400 ms, runs rules in the browser, publishes issues to the shell's avatar (state `attention` / `alert`) and to a small **issue bubble** next to the avatar: one line, **Fix** (applies the patch through the form's own setters), **Why** (opens the panel with the issue as context; Haiku explains, with the employee's memory), **Ignore**. Three ignores of the same code silence it for that form. Keyboard reachable; `aria-live="polite"`.
> 4. Wire it into the sales and purchase document forms first (find the forms that call `save_sales_invoice_draft` / `save_purchase_invoice_draft`); the form remains the source of truth; no database write from the watch.
> 5. `/api/assistant/watch` (POST): for the "unusual draft" check, rate-limited (1 per 20 s per user per form), cached by draft hash, Haiku, budget-aware.
> 6. After save: subscribe the author's session to a Supabase Realtime channel for new guard findings on their documents (a small trigger-free approach: the guard scan inserts findings; a Realtime publication on `guard_findings` filtered by the author through RLS, or a polling fallback every 60 s when Realtime is not enabled). The avatar says "The document you just saved has a problem" with a link.
> 7. `assistant_watch_events` table (shown / fixed / ignored / why, code, doc type, user) for learning (AST-3 nightly job reads it).
>
> Tests: every rule with positive and negative fixtures, patch application, debounce and silence logic, rate limit, Realtime fallback, i18n. Screenshot the bubble on a sales form.

## AST-6 — Insights for management, and the accountant inside the chat

> Before starting, check the list of available skills. Use every skill that fits (data:analyze may fit). At the end, say which skills you used, or that none fit.
>
> **Branch:** `saas/assistant-insights`.
>
> **Goal:** the assistant helps managers decide: a morning briefing, analysis on request, and sales and marketing suggestions grounded in our data. The guard's "Ask the accountant" form is replaced by the chat.
>
> Build:
> 1. `insights` skill (admins and users with `can_view_financial_reports`): read-only analytical tools over existing reports and RPCs — sales by period / customer / product with comparison to the previous period, gross margin by product, debtors ageing, stock cover and slow movers, dormant customers (bought ≥ 3 times, nothing in 60 days), co-purchase pairs (for cross-sell), price changes vs margin. Each tool returns compact numbers; the model writes the analysis (Opus via the router for "why / compare / forecast").
> 2. **Morning briefing** for each admin / manager (nightly job, same workflow pattern): yesterday's sales vs usual, cash position, overdue receivables, stock risks, new guard findings, 3 concrete suggestions (who to call, what to reorder, which price to check), each with a link. Shown as the first message of the day in the panel (avatar `success` state if all is well) and optionally as the home widget.
> 3. Marketing and sales suggestions only from our data (no invented market facts); every suggestion cites the numbers behind it.
> 4. Accountant: the guard skill (AST-1) handles questions; remove `GuardAskPanel` from the Reports tab (keep the saved reports and the Build report button that now opens the panel with "Build today's review"). Agent suggestions on findings stay.
> 5. Employee overview for admins: per employee, what they did this week (counts), recurring mistakes from watch events, and one coaching suggestion — factual, no scoring or ranking of people.
>
> Tests: each insight tool on fixtures (numbers exact), the briefing composer with a stand-in Claude client, permission gates, the guard form removed only when `ASSISTANT_V2` is on.
>
> PR: screenshots of a briefing and an analysis answer, cost per day measured on fixtures, manual steps (secrets for the nightly job).
