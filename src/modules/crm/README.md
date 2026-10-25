# CRM module (`crm`)

Depends on `core` and `sales`. The classic pipeline (`/crm`, quotations, send to production) is
unchanged. The new CRM (prompt 21) shows in the new shell only while **NEW_CRM** is on (and
NEW_UI); `/crm/leads`, `/crm/reports` and `/crm/config` are a 404 otherwise, and the classic menu
gets no new items (the new shell lists them under the CRM app).

## Goal

Sales people work leads into opportunities, move them through their team's stages, close them as
won or lost with a reason, turn a won quotation into a sales invoice, and see how the pipeline
converts and what is coming.

## What it does

- **One record, two kinds** (`deals.type`): a *lead* (not qualified yet: contact, company,
  source/medium) becomes an *opportunity* (customer, expected revenue, probability, expected
  close, priority, tags) by "Convert", which can create or link the customer.
- **Teams** (`crm_teams`, `crm_team_members`): every deal belongs to a team (seeded: "Sales").
- **Stages** (`crm_stages`): shared by all teams or a team's own; open (with a default
  probability), won (100 %) or lost (0 %). Seeded from the classic settings (`crm_config`) with the
  same codes, so every existing deal keeps its stage. `deals.stage` (the classic text code) and
  `deals.stage_id` are kept in sync by a trigger, both ways.
- **Won / lost**: "Mark won", "Mark lost" (reason from `crm_lost_reasons` and a note), "Reopen".
  Dropping a card on a lost column asks for the reason.
- **Views** (view engine): pipeline kanban by stage (drag), list, pivot, graph, calendar of
  expected closes; leads list; the form with status bar, contact tab, quotations and the chatter.
  Quick create from the pipeline and the leads list.
- **Quotation → invoice**: a won/accepted quotation becomes a **draft** sales invoice through the
  sales module's own save (`submitSale`); nothing touches stock, payments or the ledger until it is
  checked and posted in Sales. The quotation then points at the invoice and the deal is won.
- **Reports** (`/crm/reports`): funnel (reference `stats/stats-conversion-funnel-steps`),
  forecast by month (expected and weighted), win rate by salesperson, lost reasons, and this
  month's targets.
- **Settings** (`/crm/config`): stages (order, name, colour, probability), teams (leader,
  members), lost reasons, monthly targets per team or salesperson.

## Access

- Deals keep their rules: read with `can_view_crm`, change with `can_manage_crm`.
- Teams, stages, lost reasons and targets: read with `can_view_crm`, change with
  `can_manage_settings`.
- Creating a customer when converting a lead needs `can_manage_customers`; creating the invoice
  needs `can_create_invoice`.

## Acceptance (prompt 21)

All existing deals appear in the new pipeline in their stage, and lead → opportunity → quotation
→ invoice works. Logic tests in `tests/crmPipeline.test.mjs`; database rules in
`supabase/tests/crm_pipeline.sql` (CI). Rollback: `supabase/scripts/crm_pipeline_rollback.sql`.

## Out of scope

- Recurring revenue plans, UTM campaigns (source and medium are free text), activity-based lead
  scoring, merging duplicate leads.
- Stages added in the new CRM are not added to the classic settings: once NEW_CRM is on, manage
  stages in `/crm/config`.

## Approval

New behaviour stays behind NEW_CRM (off by default). One migration
(`supabase/migrations/20261025100000_crm_pipeline.sql`) that the owner runs after review.
