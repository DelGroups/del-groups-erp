-- Checks supabase/migrations/20261113100000_partner_statement_details.sql (LED-3). Runs after
-- supabase/tests/partner_ledger_test.sql on the same database (CI order) and uses its partners:
-- that test ends by re-applying the LED-1 migration, so get_partner_statement is LED-1's here.
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.

-- 1. LED-1's statement of every partner with movements, all time and the last 12 days.
create temp table old_st as
select p.partner_id, k.range_, public.get_partner_statement(p.partner_id, k.from_, public.document_today()) as st
from (select distinct partner_id from public.partner_ledger_movements) p
cross join (values ('all', null::date), ('12d', public.document_today() - 12)) k(range_, from_);

do $$
begin
  if (select count(*) from old_st) < 20 then raise exception 'FAIL expected the LED-1 fixtures (run partner_ledger_test.sql first)'; end if;
end $$;

-- 2. The migration.
\ir ../migrations/20261113100000_partner_statement_details.sql

-- 3. Same statement as before, only more keys: header, lines, balances and totals unchanged.
do $$
declare
  r record;
  v_new jsonb;
  v_old_lines jsonb;
  v_new_lines jsonb;
begin
  for r in select * from old_st loop
    v_new := public.get_partner_statement(r.partner_id, case when r.range_ = 'all' then null else public.document_today() - 12 end, public.document_today());
    if (v_new - 'partner' - 'lines') <> (r.st - 'partner' - 'lines') then
      raise exception 'FAIL totals changed for % (%): % vs %', r.partner_id, r.range_, v_new - 'partner' - 'lines', r.st - 'partner' - 'lines';
    end if;
    if (v_new -> 'partner') - 'phone' - 'email' - 'address' - 'credit_limit' <> (r.st -> 'partner') then
      raise exception 'FAIL partner header changed for %', r.partner_id;
    end if;
    if not ((v_new -> 'partner') ?& array['phone', 'email', 'address', 'credit_limit']) then
      raise exception 'FAIL partner header misses the contact fields';
    end if;
    select coalesce(jsonb_agg(l - 'doc_kind' - 'doc_id' - 'created_by' - 'created_by_name' order by n), '[]') into v_new_lines
    from jsonb_array_elements(v_new -> 'lines') with ordinality as x(l, n);
    if v_new_lines <> (r.st -> 'lines') then
      raise exception 'FAIL lines changed for % (%)', r.partner_id, r.range_;
    end if;
    if exists (select 1 from jsonb_array_elements(v_new -> 'lines') l
               where not (l ?& array['doc_kind', 'doc_id', 'created_by', 'created_by_name'])) then
      raise exception 'FAIL a line misses the new keys';
    end if;
  end loop;
end $$;

-- 4. The document each line opens, and who made it.
do $$
declare
  c2 uuid := public.resolve_unified_partner_id('00000000-0000-0000-0ed1-0000000000c2', null);
  su uuid := public.resolve_unified_partner_id(null, '00000000-0000-0000-0ed1-0000000000d5');
  v_sale uuid := (select id from public.sales where customer_id = '00000000-0000-0000-0ed1-0000000000c2' and status = 'posted' limit 1);
  v_ship uuid := (select id from public.import_shipments where invoice_no = 'INV-LED1');
  v_lines jsonb;
begin
  v_lines := public.get_partner_statement(c2, null, null) -> 'lines';
  -- The invoice and both of its payments (two accounts) open the invoice.
  if (select count(*) from jsonb_array_elements(v_lines) l
      where l ->> 'doc_kind' = 'sale' and (l ->> 'doc_id')::uuid = v_sale
        and l ->> 'source_type' in ('sale', 'sale_payment')) <> 3 then
    raise exception 'FAIL C2 sale and its two payments should open the sale: %', v_lines;
  end if;
  -- A partner payment opens no document.
  if exists (select 1 from jsonb_array_elements(v_lines) l
             where l ->> 'source_type' = 'partner_payment' and (l ->> 'doc_kind' is not null or l ->> 'doc_id' is not null)) then
    raise exception 'FAIL a partner payment has a document';
  end if;
  -- Made through the app as the admin: the invoice and the payments carry her name.
  if exists (select 1 from jsonb_array_elements(v_lines) l
             where l ->> 'source_type' in ('sale', 'sale_payment', 'partner_payment')
               and coalesce(l ->> 'created_by_name', '') <> 'Lalə Admin') then
    raise exception 'FAIL created_by_name: %', v_lines;
  end if;

  -- Import lines open the shipment.
  v_lines := public.get_partner_statement(su, null, null) -> 'lines';
  if not exists (select 1 from jsonb_array_elements(v_lines) l where l ->> 'source_type' like 'import%')
     or exists (select 1 from jsonb_array_elements(v_lines) l
                where l ->> 'source_type' like 'import%'
                  and (l ->> 'doc_kind' is distinct from 'import' or (l ->> 'doc_id')::uuid is distinct from v_ship)) then
    raise exception 'FAIL import lines should open the shipment: %', v_lines;
  end if;

  -- Opening balances open nothing.
  if exists (select 1 from public.partner_ledger_movements m where m.source_type like 'opening%')
     and exists (select 1 from old_st o, jsonb_array_elements(public.get_partner_statement(o.partner_id, null, null) -> 'lines') l
                 where l ->> 'source_type' like 'opening%' and l ->> 'doc_kind' is not null) then
    raise exception 'FAIL an opening balance has a document';
  end if;
end $$;

-- 5. Still only for financial reports: a sales-only user is refused.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0ed1-00000000000b","role":"authenticated"}', true);
do $$
declare
  v_ok boolean := false;
begin
  begin perform public.get_partner_statement(public.resolve_unified_partner_id('00000000-0000-0000-0ed1-0000000000c2', null), null, null);
  exception when insufficient_privilege then v_ok := true; end;
  if not v_ok then raise exception 'FAIL a sales-only user read a statement'; end if;
end $$;
rollback;

do $$
begin
  if (select provolatile from pg_proc where proname = 'get_partner_statement') <> 's' then
    raise exception 'FAIL get_partner_statement must stay STABLE';
  end if;
  if has_function_privilege('anon', 'public.get_partner_statement(uuid, date, date, text)', 'execute') then
    raise exception 'FAIL anon may run get_partner_statement';
  end if;
end $$;

-- The migration runs twice without errors.
\ir ../migrations/20261113100000_partner_statement_details.sql

select 'ALL CHECKS PASSED';
