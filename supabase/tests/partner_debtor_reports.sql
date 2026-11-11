-- Checks supabase/migrations/20261114100000_partner_debtor_reports.sql (LED-4). Runs after
-- supabase/tests/partner_ledger_test.sql on the same database (CI order): it reuses that test's
-- users, warehouse, accounts, products and its partners (CB is both customer and supplier,
-- SU an import supplier in USD). Its own partners are named "LED4 …". Every movement is made
-- by the app's RPCs. Any failed check raises an exception; the last line prints ALL CHECKS PASSED.
--
-- Fixtures (d0 = document_today()), customer side:
--   L1 terms 10 days: A 100 (d0-60), B 50 (d0-40) paid 20 on B (d0-30), C 30 (d0-5),
--      partner payment 120 (d0-20), partner payment 25 on d0 (after the d0-1 as-of date).
--      As of d0-1: pool 120 → A fully, B 20 of its 30 → B 10 open (due d0-30),
--      C 30 open (due d0+5, not due). Balance 40; B is 29 days late on d0-1.
--      As of d0: pool 145 → A, B fully, C 15 open. Balance 15.
--   L2 pays 70 (d0-50) before its invoice of 50 (d0-40): no open item, advance 20, balance -20.
--   L3 invoice 40 with 15 paid in the form, then cancelled: nothing open, balance 0.
--   L4 terms 30 but the invoice has its own due date d0-1: 60 open, 1 day late as of d0.

insert into public.customers (id, full_name, phone) values
  ('00000000-0000-0000-0ed4-0000000000c1', 'LED4 L1 FIFO', '+994 50 444 00 01'),
  ('00000000-0000-0000-0ed4-0000000000c2', 'LED4 L2 advance', null),
  ('00000000-0000-0000-0ed4-0000000000c3', 'LED4 L3 cancelled', null),
  ('00000000-0000-0000-0ed4-0000000000c4', 'LED4 L4 own due date', null)
on conflict (id) do nothing;

create or replace function pg_temp.p(p_customer uuid) returns uuid language sql as $$
  select public.resolve_unified_partner_id(p_customer, null);
$$;
update public.partners set payment_terms_days = 10, credit_limit = 30 where id = pg_temp.p('00000000-0000-0000-0ed4-0000000000c1');
update public.partners set payment_terms_days = 30 where id = pg_temp.p('00000000-0000-0000-0ed4-0000000000c4');

create or replace function pg_temp.sale(p_customer uuid, p_date date, p_total numeric, p_payments jsonb, p_due date default null)
returns jsonb language sql as $$
  select jsonb_build_object(
    'header', jsonb_build_object('customer_id', p_customer, 'doc_date', p_date::text, 'due_date', p_due::text,
      'total_amount', p_total, 'subtotal', p_total,
      'paid_amount', coalesce((select sum((x->>'amount')::numeric) from jsonb_array_elements(p_payments) x), 0),
      'remaining_balance', p_total - coalesce((select sum((x->>'amount')::numeric) from jsonb_array_elements(p_payments) x), 0)),
    'items', jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0ed1-000000000001', 'product_name', 'LED4', 'quantity', 1,
      'unit_price', p_total, 'line_total', p_total, 'total', p_total, 'warehouse_id', '00000000-0000-0000-0ed1-0000000000e1')),
    'payments', p_payments);
$$;
create temp table led4_ids (k text primary key, id uuid);
grant all on led4_ids to authenticated;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0ed1-00000000000a","role":"authenticated"}', false);
do $$
declare
  d0 date := public.document_today();
  v uuid;
  cash uuid := '00000000-0000-0000-0ed1-0000000000a1';
  pay jsonb := '[]'::jsonb;
begin
  -- L1
  v := (public.save_sales_invoice_draft(pg_temp.sale('00000000-0000-0000-0ed4-0000000000c1', d0 - 60, 100, pay)) ->> 'sale_id')::uuid;
  perform public.post_sales_invoice_draft(v); insert into led4_ids values ('A', v);
  v := (public.save_sales_invoice_draft(pg_temp.sale('00000000-0000-0000-0ed4-0000000000c1', d0 - 40, 50, pay)) ->> 'sale_id')::uuid;
  perform public.post_sales_invoice_draft(v); insert into led4_ids values ('B', v);
  perform public.process_invoice_payment_event(jsonb_build_object('document_type', 'sale', 'document_id', v,
    'payment_date', (d0 - 30)::text, 'idempotency_key', 'led4-b-pay',
    'lines', jsonb_build_array(jsonb_build_object('account_id', cash, 'amount', 20, 'method', 'Nağd'))));
  v := (public.save_sales_invoice_draft(pg_temp.sale('00000000-0000-0000-0ed4-0000000000c1', d0 - 5, 30, pay)) ->> 'sale_id')::uuid;
  perform public.post_sales_invoice_draft(v); insert into led4_ids values ('C', v);
  perform public.create_partner_payment(jsonb_build_object('partner_id', pg_temp.p('00000000-0000-0000-0ed4-0000000000c1'),
    'amount', 120, 'payment_type', 'in', 'payment_method', 'cash', 'cash_account_id', cash,
    'payment_date', (d0 - 20)::text, 'idempotency_key', 'led4-l1-120'));
  perform public.create_partner_payment(jsonb_build_object('partner_id', pg_temp.p('00000000-0000-0000-0ed4-0000000000c1'),
    'amount', 25, 'payment_type', 'in', 'payment_method', 'cash', 'cash_account_id', cash,
    'payment_date', d0::text, 'idempotency_key', 'led4-l1-25'));
  -- L2: money first, invoice later.
  perform public.create_partner_payment(jsonb_build_object('partner_id', pg_temp.p('00000000-0000-0000-0ed4-0000000000c2'),
    'amount', 70, 'payment_type', 'in', 'payment_method', 'cash', 'cash_account_id', cash,
    'payment_date', (d0 - 50)::text, 'idempotency_key', 'led4-l2-70'));
  v := (public.save_sales_invoice_draft(pg_temp.sale('00000000-0000-0000-0ed4-0000000000c2', d0 - 40, 50, pay)) ->> 'sale_id')::uuid;
  perform public.post_sales_invoice_draft(v);
  -- L3: paid 15 in the form, then cancelled.
  v := (public.save_sales_invoice_draft(pg_temp.sale('00000000-0000-0000-0ed4-0000000000c3', d0 - 15, 40,
    jsonb_build_array(jsonb_build_object('account_id', cash, 'amount', 15, 'method', 'Nağd')))) ->> 'sale_id')::uuid;
  perform public.post_sales_invoice_draft(v);
  perform public.cancel_sales_invoice_atomic(v, 'LED4 cancel');
  -- L4: own due date.
  v := (public.save_sales_invoice_draft(pg_temp.sale('00000000-0000-0000-0ed4-0000000000c4', d0 - 10, 60, pay, d0 - 1)) ->> 'sale_id')::uuid;
  perform public.post_sales_invoice_draft(v); insert into led4_ids values ('L4', v);
end $$;
reset role;

-- ── Open items: FIFO, linked payments, advance, cancelled, due dates, as-of ─
do $$
declare
  d0 date := public.document_today();
  l1 uuid := pg_temp.p('00000000-0000-0000-0ed4-0000000000c1');
  l2 uuid := pg_temp.p('00000000-0000-0000-0ed4-0000000000c2');
  l3 uuid := pg_temp.p('00000000-0000-0000-0ed4-0000000000c3');
  l4 uuid := pg_temp.p('00000000-0000-0000-0ed4-0000000000c4');
  v_got text;
begin
  -- As of d0-1 (the payment of d0 must not count).
  select string_agg(format('%s:%s:%s', i.k, o.remaining, o.due_date - d0), ',' order by i.k) into v_got
  from public._partner_open_items(d0 - 1, l1) o join led4_ids i on i.id = o.doc_id where o.kind = 'item';
  if v_got <> 'A:0.00:-50,B:10.00:-30,C:30.00:5' then raise exception 'FAIL L1 as of d0-1: %', v_got; end if;
  -- As of d0.
  select string_agg(format('%s:%s', i.k, o.remaining), ',' order by i.k) into v_got
  from public._partner_open_items(d0, l1) o join led4_ids i on i.id = o.doc_id where o.kind = 'item';
  if v_got <> 'A:0.00,B:0.00,C:15.00' then raise exception 'FAIL L1 as of d0: %', v_got; end if;
  -- L2: no open invoice, an advance of 20 (shown as -20).
  select string_agg(format('%s:%s', o.kind, o.remaining), ',') into v_got from public._partner_open_items(d0, l2) o where o.remaining <> 0;
  if v_got <> 'advance:-20.00' then raise exception 'FAIL L2 advance: %', v_got; end if;
  -- L3: the cancelled invoice and its reversed payment leave nothing.
  if exists (select 1 from public._partner_open_items(d0, l3) o where o.remaining <> 0) then raise exception 'FAIL L3 cancelled has open items'; end if;
  -- L4: the document's own due date wins over the partner's 30 days.
  select string_agg(format('%s:%s', o.remaining, o.due_date - d0), ',') into v_got from public._partner_open_items(d0, l4) o where o.kind = 'item';
  if v_got <> '60.00:-1' then raise exception 'FAIL L4 due date: %', v_got; end if;
end $$;

-- Open items + advance = the ledger balance, for every partner and side, on several dates.
do $$
declare
  d0 date := public.document_today();
  v_day date;
  v_bad int;
begin
  foreach v_day in array array[d0, d0 - 1, d0 - 21, d0 - 45, '2026-10-05'::date] loop
    with oi as (select partner_id, side, round(sum(remaining), 2) r from public._partner_open_items(v_day, null) group by 1, 2),
    bal as (select partner_id, side, round(sum(case when side = 'receivable' then debit - credit else credit - debit end), 2) b
            from public.partner_ledger_movements where entry_date <= v_day group by 1, 2)
    select count(*) into v_bad from bal full join oi using (partner_id, side) where coalesce(oi.r, 0) <> coalesce(bal.b, 0);
    if v_bad > 0 then raise exception 'FAIL open items <> balance on % for % sides', v_day, v_bad; end if;
  end loop;
end $$;

-- ── The report ───────────────────────────────────────────────────────────────
create or replace function pg_temp.row_of(p_report jsonb, p_partner uuid) returns jsonb language sql as $$
  select r from jsonb_array_elements(p_report -> 'rows') r where (r ->> 'partner_id')::uuid = p_partner;
$$;
create or replace function pg_temp.has(p_report jsonb, p_partner uuid) returns boolean language sql as $$
  select pg_temp.row_of(p_report, p_partner) is not null;
$$;

do $$
declare
  d0 date := public.document_today();
  l1 uuid := pg_temp.p('00000000-0000-0000-0ed4-0000000000c1');
  l2 uuid := pg_temp.p('00000000-0000-0000-0ed4-0000000000c2');
  cb uuid := public.resolve_unified_partner_id('00000000-0000-0000-0ed1-0000000000cb', null);
  su uuid := public.resolve_unified_partner_id(null, '00000000-0000-0000-0ed1-0000000000d5');
  admin uuid := '00000000-0000-0000-0ed1-00000000000a';
  r jsonb;
  x jsonb;
  all_ jsonb;
begin
  -- As-of balances: L1 on d0-1 (before the payment of d0) and on d0.
  r := public.get_debtor_creditor_report(d0 - 1, 'debtors', '{}', 'balance', 'desc', 10000, 0);
  x := pg_temp.row_of(r, l1);
  if x is null or (x ->> 'balance')::numeric <> 40 or (x ->> 'overdue')::numeric <> 10 or (x ->> 'oldest_overdue_days')::int <> 29
     or (x ->> 'open_count')::int <> 2 or (x ->> 'payment_terms_days')::int <> 10 or (x ->> 'credit_used_pct')::numeric <> 133.3
     or (x ->> 'phone') <> '+994 50 444 00 01' then
    raise exception 'FAIL L1 debtor row on d0-1: %', x;
  end if;
  if (x ->> 'last_payment_date')::date <> d0 - 20 or (x ->> 'last_payment_amount')::numeric <> 120 then raise exception 'FAIL L1 last payment: %', x; end if;
  x := pg_temp.row_of(public.get_debtor_creditor_report(d0, 'debtors', '{}', 'balance', 'desc', 10000, 0), l1);
  if (x ->> 'balance')::numeric <> 15 or (x ->> 'overdue')::numeric <> 0 or (x ->> 'last_payment_amount')::numeric <> 25 then raise exception 'FAIL L1 on d0: %', x; end if;
  -- Every debtor row's balance is the LED-1 receivable on that date.
  if exists (select 1 from jsonb_array_elements(r -> 'rows') e
             join public.get_partner_balances(d0 - 1) b on b.partner_id = (e ->> 'partner_id')::uuid
             where b.receivable <> (e ->> 'balance')::numeric) then
    raise exception 'FAIL debtor balances differ from get_partner_balances';
  end if;
  -- Tabs: L2 (advance) is no debtor, only in Net with -20 and its advance; CB is in both tabs.
  if pg_temp.has(r, l2) then raise exception 'FAIL L2 among debtors'; end if;
  x := pg_temp.row_of(public.get_debtor_creditor_report(d0, 'net', '{}', 'balance', 'desc', 10000, 0), l2);
  if (x ->> 'balance')::numeric <> -20 or (x ->> 'advance')::numeric <> 20 then raise exception 'FAIL L2 net row: %', x; end if;
  if (pg_temp.row_of(public.get_debtor_creditor_report(d0, 'debtors', '{}', 'balance', 'desc', 10000, 0), cb) ->> 'balance')::numeric <> 80
     or (pg_temp.row_of(public.get_debtor_creditor_report(d0, 'creditors', '{}', 'balance', 'desc', 10000, 0), cb) ->> 'balance')::numeric <> 40
     or (pg_temp.row_of(public.get_debtor_creditor_report(d0, 'net', '{}', 'balance', 'desc', 10000, 0), cb) ->> 'balance')::numeric <> 40 then
    raise exception 'FAIL CB on both sides';
  end if;
  -- Totals, KPIs and the count match the rows.
  if (r -> 'totals' ->> 'balance')::numeric <> (select sum((e ->> 'balance')::numeric) from jsonb_array_elements(r -> 'rows') e)
     or (r ->> 'total_count')::int <> jsonb_array_length(r -> 'rows') then
    raise exception 'FAIL debtor totals';
  end if;
  all_ := public.get_debtor_creditor_report(d0, 'net', '{}', 'balance', 'desc', 10000, 0);
  if (all_ -> 'kpi' ->> 'net')::numeric <> (select sum((e ->> 'balance')::numeric) from jsonb_array_elements(all_ -> 'rows') e)
     or jsonb_array_length(all_ -> 'kpi' -> 'top_debtors') > 10 then
    raise exception 'FAIL KPI net / top debtors';
  end if;

  -- Filters.
  r := public.get_debtor_creditor_report(d0 - 1, 'debtors', '{"search": "led4 l1"}', 'balance', 'desc', 50, 0);
  if (r ->> 'total_count')::int <> 1 or not pg_temp.has(r, l1) then raise exception 'FAIL search by name: %', r -> 'total_count'; end if;
  if not pg_temp.has(public.get_debtor_creditor_report(d0 - 1, 'debtors', '{"search": "444 00 01"}', 'balance', 'desc', 50, 0), l1) then raise exception 'FAIL search by phone'; end if;
  if pg_temp.has(public.get_debtor_creditor_report(d0 - 1, 'debtors', '{"type": "supplier"}', 'balance', 'desc', 10000, 0), l1) then raise exception 'FAIL type filter'; end if;
  if not pg_temp.has(public.get_debtor_creditor_report(d0 - 1, 'debtors', '{"type": "partner"}', 'balance', 'desc', 10000, 0), cb) then raise exception 'FAIL type both'; end if;
  r := public.get_debtor_creditor_report(d0 - 1, 'debtors', '{"overdue_only": true}', 'balance', 'desc', 10000, 0);
  if not pg_temp.has(r, l1) or exists (select 1 from jsonb_array_elements(r -> 'rows') e where (e ->> 'overdue')::numeric <= 0) then raise exception 'FAIL overdue only'; end if;
  if pg_temp.has(public.get_debtor_creditor_report(d0 - 1, 'debtors', '{"min_amount": 41}', 'balance', 'desc', 10000, 0), l1) then raise exception 'FAIL min amount'; end if;
  if not pg_temp.has(public.get_debtor_creditor_report(d0 - 1, 'debtors', '{"min_amount": 40}', 'balance', 'desc', 10000, 0), l1) then raise exception 'FAIL min amount edge'; end if;
  r := public.get_debtor_creditor_report(d0 - 1, 'debtors', '{"over_limit_only": true}', 'balance', 'desc', 10000, 0);
  if not pg_temp.has(r, l1) or (r ->> 'total_count')::int <> 1 then raise exception 'FAIL over limit only: %', r -> 'total_count'; end if;
  if not pg_temp.has(public.get_debtor_creditor_report(d0 - 1, 'debtors', jsonb_build_object('user_id', admin), 'balance', 'desc', 10000, 0), l1)
     or pg_temp.has(public.get_debtor_creditor_report(d0 - 1, 'debtors', jsonb_build_object('user_id', '00000000-0000-0000-0ed1-00000000000b'), 'balance', 'desc', 10000, 0), l1) then
    raise exception 'FAIL created-by filter';
  end if;
  r := public.get_debtor_creditor_report(d0, 'creditors', '{"currency": "usd"}', 'balance', 'desc', 10000, 0);
  if not pg_temp.has(r, su) or pg_temp.has(public.get_debtor_creditor_report(d0, 'debtors', '{"currency": "USD"}', 'balance', 'desc', 10000, 0), l1) then
    raise exception 'FAIL currency filter';
  end if;
  -- A search with LIKE characters is taken literally.
  if (public.get_debtor_creditor_report(d0, 'net', '{"search": "%"}', 'balance', 'desc', 10, 0) ->> 'total_count')::int <> 0 then raise exception 'FAIL search escaping'; end if;

  -- Paging and sorting.
  r := public.get_debtor_creditor_report(d0, 'net', '{}', 'name', 'asc', 2, 0);
  x := public.get_debtor_creditor_report(d0, 'net', '{}', 'name', 'asc', 2, 2);
  if jsonb_array_length(r -> 'rows') <> 2 or (r -> 'rows' -> 1 ->> 'partner_id') = (x -> 'rows' -> 0 ->> 'partner_id')
     or lower(r -> 'rows' -> 0 ->> 'partner_name') > lower(r -> 'rows' -> 1 ->> 'partner_name')
     or (r ->> 'total_count') <> (all_ ->> 'total_count') then
    raise exception 'FAIL paging / sorting';
  end if;
  r := public.get_debtor_creditor_report(d0, 'debtors', '{}', 'balance', 'asc', 10000, 0);
  if exists (select 1 from jsonb_array_elements(r -> 'rows') with ordinality a(e, n) join jsonb_array_elements(r -> 'rows') with ordinality b(e, n) on b.n = a.n + 1
             where (a.e ->> 'balance')::numeric > (b.e ->> 'balance')::numeric) then
    raise exception 'FAIL sort by balance';
  end if;
  begin
    perform public.get_debtor_creditor_report(d0, 'debtors', '{}', 'drop table x', 'asc', 10, 0);
    raise exception 'FAIL unknown sort accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- ── Turnover: equals the statement for every partner; DSO ─────────────────────
do $$
declare
  d0 date := public.document_today();
  l1 uuid := pg_temp.p('00000000-0000-0000-0ed4-0000000000c1');
  t jsonb;
  v_bad int;
begin
  t := public.get_partner_turnover(d0 - 45, d0 - 1, '{}', 'name', 'asc', 10000, 0);
  select count(*) into v_bad
  from jsonb_array_elements(t -> 'rows') r,
       lateral (select public.get_partner_statement((r ->> 'partner_id')::uuid, d0 - 45, d0 - 1, 'net') s) x
  where (r ->> 'opening')::numeric <> (x.s ->> 'opening_balance')::numeric
     or (r ->> 'debit')::numeric <> (x.s ->> 'period_debit')::numeric
     or (r ->> 'credit')::numeric <> (x.s ->> 'period_credit')::numeric
     or (r ->> 'closing')::numeric <> (x.s ->> 'closing_balance')::numeric;
  if v_bad > 0 or jsonb_array_length(t -> 'rows') < 5 then raise exception 'FAIL turnover vs statement: % of %', v_bad, jsonb_array_length(t -> 'rows'); end if;
  if (t -> 'totals' ->> 'closing')::numeric <> (select sum((r ->> 'closing')::numeric) from jsonb_array_elements(t -> 'rows') r) then
    raise exception 'FAIL turnover totals';
  end if;
  -- L1: receivable 100 at the start, 40 at the end, sales 80 in 45 days → DSO = 70 / 80 × 45 = 39.4.
  if (pg_temp.row_of(t, l1) ->> 'dso')::numeric <> 39.4 or pg_temp.row_of(t, l1) ->> 'dpo' is not null then
    raise exception 'FAIL DSO: %', pg_temp.row_of(t, l1);
  end if;
  if (public.get_partner_turnover(d0 - 45, d0 - 1, '{"search": "LED4 L1"}', 'name', 'asc', 50, 0) -> 'totals' ->> 'dso')::numeric <> 39.4 then
    raise exception 'FAIL overall DSO of one partner';
  end if;
  begin
    perform public.get_partner_turnover(d0, d0 - 1, '{}', 'name', 'asc', 10, 0);
    raise exception 'FAIL reversed period accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- ── Who may read ─────────────────────────────────────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0ed1-00000000000b","role":"authenticated"}', true);
do $$
declare
  v_ok int := 0;
begin
  begin perform public.get_debtor_creditor_report(null, 'debtors', '{}', 'balance', 'desc', 10, 0);
  exception when insufficient_privilege then v_ok := v_ok + 1; end;
  begin perform public.get_partner_turnover(current_date - 30, current_date, '{}', 'name', 'asc', 10, 0);
  exception when insufficient_privilege then v_ok := v_ok + 1; end;
  if v_ok <> 2 then raise exception 'FAIL a sales-only user read the reports'; end if;
end $$;
rollback;

do $$
begin
  if has_function_privilege('anon', 'public.get_debtor_creditor_report(date, text, jsonb, text, text, integer, integer)', 'execute')
     or has_function_privilege('anon', 'public.get_partner_turnover(date, date, jsonb, text, text, integer, integer)', 'execute')
     or has_function_privilege('authenticated', 'public._partner_open_items(date, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._partner_report_facts(date)', 'execute') then
    raise exception 'FAIL grants';
  end if;
  if exists (select 1 from pg_proc where proname in ('_partner_open_items', '_partner_report_facts', 'get_debtor_creditor_report', 'get_partner_turnover') and provolatile <> 's') then
    raise exception 'FAIL report functions must be STABLE';
  end if;
end $$;

-- The migration runs twice without errors.
\ir ../migrations/20261114100000_partner_debtor_reports.sql

select 'ALL CHECKS PASSED';
