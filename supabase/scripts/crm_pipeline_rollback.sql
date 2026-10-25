-- Undoes supabase/migrations/20261025100000_crm_pipeline.sql (prompt 21).
-- Run only when the new CRM must be removed. deals.stage (the classic text code) was kept in sync,
-- so the classic pipeline keeps every deal in its stage. LOST: teams, team-only stages, targets,
-- lost reasons, and the new deal fields (type, probability, expected close, contact info, tags,
-- source/medium, lost reason) and quotations.sale_id. Export them first if they matter.
-- Stages created in the new CRM that the classic settings do not know show nowhere in the
-- classic pipeline: move those deals to a known stage before running this.

begin;

drop trigger if exists crm_deals_sync on public.deals;
drop trigger if exists crm_stages_before_delete on public.crm_stages;
drop trigger if exists crm_teams_touch on public.crm_teams;

alter table public.quotations drop column if exists sale_id;

alter table public.deals drop constraint if exists deals_type_check;
alter table public.deals drop constraint if exists deals_crm_fields_check;
alter table public.deals
  drop column if exists type,
  drop column if exists team_id,
  drop column if exists stage_id,
  drop column if exists probability,
  drop column if exists expected_close,
  drop column if exists priority,
  drop column if exists tags,
  drop column if exists contact_name,
  drop column if exists email,
  drop column if exists phone,
  drop column if exists company_name,
  drop column if exists source,
  drop column if exists medium,
  drop column if exists lost_reason_id,
  drop column if exists lost_note,
  drop column if exists won_at,
  drop column if exists lost_at,
  drop column if exists converted_at,
  drop column if exists sequence;

drop table if exists public.crm_targets;
drop table if exists public.crm_team_members;
drop table if exists public.crm_stages;
drop table if exists public.crm_lost_reasons;
drop table if exists public.crm_teams;

drop function if exists public.crm_deals_sync();
drop function if exists public.crm_stages_before_delete();
drop function if exists public.crm_teams_touch();
drop function if exists public.crm_stage_for_code(text, uuid);
drop function if exists public.crm_outcome_stage(uuid, boolean);
drop function if exists public.crm_first_stage(uuid);
drop function if exists public.crm_default_team();

commit;
