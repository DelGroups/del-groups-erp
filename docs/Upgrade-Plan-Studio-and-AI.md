# Upgrade plan: Del Groups Studio and native AI assistant

**Date:** 2026-10-05
**Inputs:** `ODOO20_REFERENCE_SPEC_FOR_DEL_GROUPS_ERP.md` (§2, §10, §11) and the read-only audit
`DEL_GROUPS_ERP_GAP_ANALYSIS_FOR_CLAUDE_CODE.md` (P2-1, P2-2). Odoo is used for concepts only; no Odoo code is copied.

Bug fixes (P0-4 … P0-13) and the missing BOM/commission objects are tracked separately and are not part of this plan.

## Gap list

| Spec item | What exists today | Gap |
|---|---|---|
| §11 AI agent = prompt + skills + tools | `/api/ai/n8n-bridge` (webhook to n8n) and `/api/ai-assistant` (one fixed JSON snapshot sent to one model) | No tool calling, no per-question model choice, no history, no cost log |
| §11 tools are permission-checked API methods with JSON schemas | Snapshot queries in `src/lib/ai/context.ts` gated by legacy permissions | No tool registry |
| §11 explicit confirmation before every write, audit of AI actions | — | Missing (AI is read-only today) |
| §11 conversation history per user | — | Missing |
| §2.1 metadata registry (models, fields, views, menus) | Hard-coded pages and types | Missing |
| §2.5 / §10.4 custom fields on existing models | — | Missing |
| §10.6 automation rules (trigger → action) | `erp_events` table and DB triggers, not user-configurable | Missing |
| §10.5 approval rules on buttons | Warehouse-slip approval only (hard-coded) | Missing |
| §10.3 new app / model wizard | — | Missing |
| §10.7 export / import of customizations | — | Missing |
| §2.7 chatter, activities | `audit_logs` diff log only | Missing (needed by automations and AI context) |

## Phases (one branch and one PR each)

1. **Native AI assistant on the Claude API** (this PR). Model router (Haiku 4.5 / Sonnet 5.5 / Opus 5.5 by question type),
   read-only tools that run with the user's own RLS permissions, conversation history and a token/cost log.
   Behind `AI_NATIVE_ENABLED`, admins only by default.
2. **Studio foundation: custom fields.** `meta_models` / `meta_fields` / `meta_field_options` registry,
   `custom_fields JSONB` on sales, customers, suppliers, products, purchases and production orders,
   an admin page to define fields (text, number, money, date, checkbox, selection, link to record),
   and rendering of those fields on the existing forms and lists. AI tools read custom fields automatically.
3. **Automations and approvals.** Rules `trigger (create / update / state set / time) → action (set field, create activity, notify, webhook)`
   run from DB events; approval rules on document actions with conditions (e.g. sale total > 5,000 AZN needs a manager),
   multi-step order and an approval log. Chatter/activities land here because both features need them.
4. **AI write tools.** Create/update tools (draft sale, customer, product, activity) that return a preview and
   need an explicit "Yes, do it" in the chat; every AI write is recorded in `audit_logs` with the conversation id.
5. **New app wizard and customization packages.** Create a custom model with presets (stages, tags, lines, money, dates),
   generated list/kanban/form views and menu entry; export/import all customizations as one JSON package.

Each phase ships off by default (feature flag or admin-only page) so merging to `main` does not change what staff see.

## Phase 1 details

| Piece | File |
|---|---|
| Router (tier per question, env overrides, cost estimate) | `src/lib/ai/native/router.ts` |
| Read-only tools (products, stock alerts, customers, debtors, sales, one sale, finance, production) | `src/lib/ai/native/tools.ts` |
| Tool-use loop (max 6 steps, prompt caching, refusal fallback) | `src/lib/ai/native/agent.ts` |
| Flag | `src/lib/ai/native/config.ts` |
| History + usage log (degrades gracefully before the migration) | `src/lib/ai/native/store.ts`, `supabase/migrations/20261005100000_ai_native_assistant.sql` |
| API | `POST/GET /api/ai/agent` |
| Widget | text messages go to `/api/ai/agent` when it is enabled for the user; voice/file still use the n8n bridge |

### Turning it on

1. Run `supabase/migrations/20261005100000_ai_native_assistant.sql` in Supabase (optional but needed for history and the cost log).
2. On the server, add to `.env.production`: `ANTHROPIC_API_KEY=…` and `AI_NATIVE_ENABLED=1`. Restart the container.
3. Admins now get the native assistant in the widget. When it looks right, set `AI_NATIVE_AUDIENCE=all`.

Routing: greetings and short lookups → `claude-haiku-4-5`; everyday questions → `claude-sonnet-5-5` (effort low);
analysis / comparison / forecast / "why" / long prompts → `claude-opus-5-5` (effort medium).
Override any tier with `AI_MODEL_FAST`, `AI_MODEL_STANDARD`, `AI_MODEL_DEEP`.

Cost per question is in `ai_usage_log.cost_usd`, e.g.
`select tier, count(*), sum(cost_usd) from ai_usage_log where created_at > now() - interval '30 days' group by tier;`
