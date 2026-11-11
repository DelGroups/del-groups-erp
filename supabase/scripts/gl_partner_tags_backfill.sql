-- LED-2: GL partner tags backfill. Run ONLY after Del has reviewed the results of
-- gl_partner_tags_report.sql. It sets journal_entry_lines.partner_id (and partner_type
-- 'partner') on 1200 / 2100 lines without a partner where the report's rules find
-- exactly ONE partner.
--
-- It never changes an amount, an account, a date or a journal entry: only the partner
-- tag of those lines (the entries stay balanced). Every changed line is written to
-- audit_logs with the old and the new partner, so it can be reviewed or undone.
-- One transaction; prints the counts before and after. Idempotent: a second run changes
-- nothing (fixed lines no longer match).

begin;

create temp table _gl_tag_fix on commit drop as
with lines as (
  select l.id as line_id, l.journal_entry_id, l.partner_id, l.partner_type, a.code, l.debit, l.credit,
         e.entry_date, e.document_type, e.document_id, e.source_type, e.source_id, e.description
  from public.journal_entry_lines l
  join public.chart_of_accounts a on a.id = l.coa_id
  join public.journal_entries e on e.id = l.journal_entry_id
  -- partner_id is a validated foreign key to partners: an empty one is the only wrong value.
  where a.code in ('1200', '2100') and l.partner_id is null
),
candidates as (
  -- matching rules (begin): keep this block identical in the report and the backfill.
  -- B. The entry's cash row(s) and the document they pay (invoice payments, stornos, advances).
  select x.line_id,
         public._gl_partner_for_source(
           case when t.reference_type in ('sale', 'purchase') then t.reference_type else t.source_type end,
           case when t.reference_type in ('sale', 'purchase') then t.reference_id else t.source_id end) as partner,
         'B cash row of ' || coalesce(case when t.reference_type in ('sale', 'purchase') then t.reference_type end, t.source_type, '?') as rule
  from lines x join public.transactions t on t.journal_entry_id = x.journal_entry_id
  union all
  -- C. Opening-balance entries: their customer / supplier.
  select x.line_id, public._partner_ledger_partner(x.document_id, null), 'C customer opening balance'
  from lines x where x.document_type = 'customer_opening_balance'
  union all
  select x.line_id, public._partner_ledger_partner(null, x.document_id), 'C supplier opening balance'
  from lines x where x.document_type = 'supplier_opening_balance'
  union all
  -- D. The entry's document or source is a sale or a purchase (two joins keep the indexes).
  select x.line_id, public._gl_partner_for_source('sale', d.id), 'D sale document'
  from lines x join public.sales d on d.id = x.document_id
  union all
  select x.line_id, public._gl_partner_for_source('sale', d.id), 'D sale document'
  from lines x join public.sales d on d.id = x.source_id
  union all
  select x.line_id, public._gl_partner_for_source('purchase', d.id), 'D purchase document'
  from lines x join public.purchases d on d.id = x.document_id
  union all
  select x.line_id, public._gl_partner_for_source('purchase', d.id), 'D purchase document'
  from lines x join public.purchases d on d.id = x.source_id
  -- matching rules (end)
),
proposal as (
  select c.line_id,
         count(distinct c.partner) filter (where c.partner is not null) as partners_found,
         min(c.partner::text) filter (where c.partner is not null)::uuid as partner,
         string_agg(distinct c.rule, ', ') as rules
  from candidates c group by c.line_id
)
select x.line_id, x.journal_entry_id, x.partner_id as old_partner_id, x.partner_type as old_partner_type,
       p.partner as new_partner_id
from lines x
join proposal p on p.line_id = x.line_id
where p.partners_found = 1;

-- Before.
select 'before' as step,
       count(*) filter (where l.partner_id is null) as lines_without_partner,
       (select count(*) from _gl_tag_fix) as lines_to_fix
from public.journal_entry_lines l
join public.chart_of_accounts a on a.id = l.coa_id and a.code in ('1200', '2100');

-- The audit trail first (old and new partner per line).
insert into public.audit_logs (id, user_id, action, module, table_name, record_id, old_values_json, new_values_json, created_at)
select gen_random_uuid(), null, 'UPDATE', 'FINANCE', 'journal_entry_lines', f.line_id,
       jsonb_build_object('partner_id', f.old_partner_id, 'partner_type', f.old_partner_type),
       jsonb_build_object('partner_id', f.new_partner_id, 'partner_type', 'partner', 'event', 'LED2_GL_PARTNER_BACKFILL',
                          'journal_entry_id', f.journal_entry_id),
       now()
from _gl_tag_fix f;

-- Only the tag.
update public.journal_entry_lines l
set partner_id = f.new_partner_id,
    partner_type = 'partner'
from _gl_tag_fix f
where l.id = f.line_id
  and l.partner_id is distinct from f.new_partner_id;

-- After.
select 'after' as step,
       count(*) filter (where l.partner_id is null) as lines_without_partner,
       (select count(*) from _gl_tag_fix) as lines_fixed
from public.journal_entry_lines l
join public.chart_of_accounts a on a.id = l.coa_id and a.code in ('1200', '2100');

commit;
