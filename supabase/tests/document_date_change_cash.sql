-- Checks supabase/migrations/20261110151000_document_date_change_cash.sql (DATE-2) on a database
-- built with scripts/db/build-fresh.sh --plain-postgres (CI: .github/workflows/db-baseline.yml).
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.
-- Leaves test rows behind: run it on a throwaway database only.
--
-- One passing and one blocked change per cash document type: an invoice payment, a partner
-- payment, a manual cash row, a company-paid expense with a VAT split and an employee-paid
-- expense. Days are relative to today (T). Transfers are not covered (none exist in the app).

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-00dd-00000000000a', 'dd-a@example.test', '{"full_name": "Dilarə Admin", "role_name": "Admin"}'),
  ('00000000-0000-0000-00dd-00000000000e', 'dd-e@example.test', '{"full_name": "Elşən Maliyyə", "role_name": "Manager"}')
on conflict (id) do nothing;
insert into public.roles (id, name, permissions)
values ('00000000-0000-0000-00dd-0000000000f0', 'DD finance', '{"can_manage_finance": true, "can_manage_expenses": true, "can_edit_posted_sales": true}')
on conflict (id) do nothing;
update public.profiles set role_id = (select id from public.roles where name = 'Admin' order by is_system desc limit 1), is_active = true
where id = '00000000-0000-0000-00dd-00000000000a';
update public.profiles set role_id = '00000000-0000-0000-00dd-0000000000f0', is_active = true
where id = '00000000-0000-0000-00dd-00000000000e';

insert into public.warehouses (id, code, name, is_default, created_at) values
  ('00000000-0000-0000-00dd-0000000000e1', 'DD-W', 'DD main', false, now()) on conflict (id) do nothing;
-- IPA: the till of the invoice payment; PPA: the till of the partner payment;
-- EA / EV: the main and the VAT account of the expenses (EA starts with 1000).
insert into public.accounts (id, code, name, balance) values
  ('00000000-0000-0000-00dd-0000000000a1', 'DD-IPA', 'DD invoice till', 0),
  ('00000000-0000-0000-00dd-0000000000a2', 'DD-PPA', 'DD partner till', 0),
  ('00000000-0000-0000-00dd-0000000000a3', 'DD-EA', 'DD expense main', 0),
  ('00000000-0000-0000-00dd-0000000000a4', 'DD-EV', 'DD expense VAT', 0)
on conflict (id) do nothing;
insert into public.customers (id, full_name) values ('00000000-0000-0000-00dd-0000000000c1', 'DD customer') on conflict (id) do nothing;
insert into public.partners (id, name, entity_type, is_customer, is_supplier, created_at, credit_limit, is_deleted) values
  ('00000000-0000-0000-00dd-0000000000b1', 'DD partner', 'legal', true, true, now(), 0, false)
on conflict (id) do nothing;
insert into public.products (id, code, name, stock, buy_price, is_service, inventory_mode, full_sheet_length_m) values
  ('00000000-0000-0000-00dd-000000000001', 'DD-P1', 'DD product', 0, 5, false, 'standard', 4)
on conflict (id) do nothing;
insert into public.financial_categories (id, name, type, is_active, created_at) values
  ('00000000-0000-0000-00dd-0000000000f1', 'DD services', 'EXPENSE', true, now())
on conflict (id) do nothing;
insert into public.employees (id, code, employee_code, full_name, position, department, status, salary, phone) values
  ('00000000-0000-0000-00dd-0000000000d1', 'DD-1', 'DD-001', 'Nigar Əliyeva', 'Satıcı', 'Satış', 'active', 800, '+994500000099')
on conflict (id) do nothing;
-- The employee's ledger lines carry the employee as the partner (as the partner sync does in the app).
insert into public.partners (id, name, entity_type, is_customer, is_supplier, created_at, credit_limit, is_deleted) values
  ('00000000-0000-0000-00dd-0000000000d1', 'Nigar Əliyeva', 'physical', false, false, now(), 0, false)
on conflict (id) do nothing;
select public.adjust_warehouse_stock('00000000-0000-0000-00dd-000000000001', '00000000-0000-0000-00dd-0000000000e1', 100);
select public.create_inventory_batch('00000000-0000-0000-00dd-000000000001', gen_random_uuid(), 'opening_balance', 5, 100);
update public.inventory_batches set created_at = now() - interval '200 days'
where product_id = '00000000-0000-0000-00dd-000000000001';
select public.post_cash_transaction('00000000-0000-0000-00dd-0000000000a3', 'Mədaxil', 1000, 'Digər mədaxil', 'DD opening');
update public.transactions set transaction_date = now() - interval '200 days'
where account_id = '00000000-0000-0000-00dd-0000000000a3' and notes = 'DD opening';

create or replace function pg_temp.codes(p jsonb, p_kind text) returns text[] language sql as $$
  select coalesce(array_agg(x->>'code' order by x->>'code'), '{}') from jsonb_array_elements(p->p_kind) x;
$$;
create or replace function pg_temp.day(p timestamptz) returns date language sql immutable as $$
  select (p at time zone 'Asia/Baku')::date;
$$;
create temp table dd_ids (k text primary key, id uuid);
grant all on dd_ids to authenticated;

-- ── Documents, booked by the admin ──────────────────────────────────────────
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00dd-00000000000a","role":"authenticated"}', false);
do $$
declare
  t date := public.document_today();
  v_id uuid;
  r jsonb;
begin
  -- SX: a sale of 100 on T-15, unpaid.
  v_id := (public.save_sales_invoice_draft(jsonb_build_object(
    'header', jsonb_build_object('customer_id', '00000000-0000-0000-00dd-0000000000c1', 'doc_date', (t - 15)::text,
      'total_amount', 100, 'subtotal', 100, 'paid_amount', 0, 'remaining_balance', 100),
    'items', jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-00dd-000000000001', 'product_name', 'DD',
      'quantity', 10, 'unit_price', 10, 'line_total', 100, 'total', 100, 'warehouse_id', '00000000-0000-0000-00dd-0000000000e1')),
    'payments', '[]'::jsonb)) ->> 'sale_id')::uuid;
  perform public.post_sales_invoice_draft(v_id);
  insert into dd_ids values ('sx', v_id);

  -- IP: 40 paid on SX from the three-dot menu, into IPA on T-10.
  r := public.process_invoice_payment_event(jsonb_build_object('document_type', 'sale', 'document_id', v_id,
    'amount', 40, 'account_id', '00000000-0000-0000-00dd-0000000000a1', 'method', 'Nağd', 'payment_date', (t - 10)::text));
  insert into dd_ids select 'ip', id from public.transactions
  where source_type = 'sale' and source_id = v_id and category = 'Satış Ödənişi';

  -- PP: a customer pays 60 into PPA on T-10.
  r := public.create_partner_payment(jsonb_build_object('partner_id', '00000000-0000-0000-00dd-0000000000b1',
    'payment_type', 'in', 'payment_method', 'cash', 'amount', 60, 'cash_account_id', '00000000-0000-0000-00dd-0000000000a2',
    'payment_date', ((t - 10)::timestamp + time '11:30') at time zone 'Asia/Baku'));
  insert into dd_ids select 'pp', id from public.payments where partner_id = '00000000-0000-0000-00dd-0000000000b1';
end $$;
reset role;
-- Manual cash rows (booked as the owner: use_document_date is internal):
--   MC1 spends the 40 of IPA on T-8; MC2 spends the 60 of PPA on T-7; MC3 brings 18 into EV on T-5.
begin;
select public.use_document_date(public.document_today() - 8);
select public.post_cash_transaction('00000000-0000-0000-00dd-0000000000a1', 'Məxaric', 40, 'Digər məxaric', 'DD mc1');
commit;
begin;
select public.use_document_date(public.document_today() - 7);
select public.post_cash_transaction('00000000-0000-0000-00dd-0000000000a2', 'Məxaric', 60, 'Digər məxaric', 'DD mc2');
commit;
begin;
select public.use_document_date(public.document_today() - 5);
select public.post_cash_transaction('00000000-0000-0000-00dd-0000000000a4', 'Mədaxil', 18, 'Digər mədaxil', 'DD mc3');
commit;
insert into dd_ids select 'mc1', id from public.transactions where notes = 'DD mc1';
insert into dd_ids select 'mc2', id from public.transactions where notes = 'DD mc2';

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00dd-00000000000a","role":"authenticated"}', false);
do $$
declare
  t date := public.document_today();
  r jsonb;
begin
  -- EX: a company-paid expense on T-3: 100 net from EA, 18 VAT from EV.
  r := public.record_expense_atomic(jsonb_build_object('expense_date', (t - 3)::text, 'category_id', '00000000-0000-0000-00dd-0000000000f1',
    'payment_mode', 'company', 'account_id', '00000000-0000-0000-00dd-0000000000a3', 'vat_account_id', '00000000-0000-0000-00dd-0000000000a4',
    'net_amount', 100, 'vat_rate', 18, 'description', 'DD consulting', 'post', true));
  insert into dd_ids values ('ex', (r->>'id')::uuid);
  -- EE: an employee-paid expense of 50 on T-10, approved, reimbursed from EA on T-9.
  r := public.record_expense_atomic(jsonb_build_object('expense_date', (t - 10)::text, 'category_id', '00000000-0000-0000-00dd-0000000000f1',
    'payment_mode', 'employee', 'employee_id', '00000000-0000-0000-00dd-0000000000d1', 'net_amount', 50, 'vat_rate', 0,
    'description', 'DD taxi', 'submit', true));
  insert into dd_ids values ('ee', (r->>'id')::uuid);
  perform public.approve_expense_atomic((r->>'id')::uuid);
  perform public.reimburse_expense_atomic((r->>'id')::uuid, '00000000-0000-0000-00dd-0000000000a3', t - 9);
end $$;

do $$
declare
  t date := public.document_today();
begin
  if (select count(*) from dd_ids) <> 7 then raise exception 'FAIL setup: % documents', (select count(*) from dd_ids); end if;
  if (select count(*) from public.transactions where source_type = 'expense' and source_id = (select id from dd_ids where k = 'ex')) <> 2 then
    raise exception 'FAIL setup: the expense has no VAT split';
  end if;
  if (select pg_temp.day(transaction_date) from public.transactions where id = (select id from dd_ids where k = 'ip')) <> t - 10 then
    raise exception 'FAIL setup: invoice payment not on T-10';
  end if;
end $$;

-- ── Which document a cash row belongs to ────────────────────────────────────
do $$
declare
  r jsonb;
begin
  r := public.resolve_date_change_document((select id from dd_ids where k = 'ip'));
  if r->>'type' <> 'invoice_payment' or (r->>'id')::uuid <> (select id from dd_ids where k = 'ip') then raise exception 'FAIL resolve ip: %', r; end if;
  r := public.resolve_date_change_document((select transaction_id from public.payments where id = (select id from dd_ids where k = 'pp')));
  if r->>'type' <> 'partner_payment' or (r->>'id')::uuid <> (select id from dd_ids where k = 'pp') then raise exception 'FAIL resolve pp: %', r; end if;
  r := public.resolve_date_change_document((select id from dd_ids where k = 'mc1'));
  if r->>'type' <> 'cash_transaction' then raise exception 'FAIL resolve mc1: %', r; end if;
  r := public.resolve_date_change_document((select min(id::text)::uuid from public.transactions where source_type = 'expense' and source_id = (select id from dd_ids where k = 'ex')));
  if r->>'type' <> 'expense' or (r->>'id')::uuid <> (select id from dd_ids where k = 'ex') then raise exception 'FAIL resolve ex: %', r; end if;
end $$;

-- ── Invoice payment ──────────────────────────────────────────────────────────
do $$
declare
  t date := public.document_today();
  ip uuid := (select id from dd_ids where k = 'ip');
  sx uuid := (select id from dd_ids where k = 'sx');
  p jsonb;
  r jsonb;
begin
  -- Blocked (R7): before the invoice (T-15).
  p := public.preview_document_date_change('invoice_payment', ip, t - 16);
  if (p->>'ok')::boolean or not ('payment_before_its_invoice' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL ip R7: %', p; end if;
  -- Blocked (R6): after the till spent it (T-8).
  p := public.preview_document_date_change('invoice_payment', ip, t - 7);
  if not ('cash_negative' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL ip R6: %', p; end if;
  -- Passes: T-12.
  p := public.preview_document_date_change('invoice_payment', ip, t - 12);
  if not (p->>'ok')::boolean then raise exception 'FAIL ip T-12 should pass: %', p; end if;
  if (p->'affected'->>'cash')::int <> 1 or (p->'affected'->>'journals')::int <> 1 then raise exception 'FAIL ip affected: %', p->'affected'; end if;
  r := public.apply_document_date_change('invoice_payment', ip, t - 12, 'Paid on the 12th, booked late');
  if not (r->>'ok')::boolean then raise exception 'FAIL ip apply: %', r; end if;
  if (select pg_temp.day(transaction_date) from public.transactions where id = ip) <> t - 12 then raise exception 'FAIL ip cash row not moved'; end if;
  if exists (select 1 from public.transactions tx join public.journal_entries je on je.id = tx.journal_entry_id
             where tx.id = ip and (je.entry_date <> t - 12 or pg_temp.day(je.date) <> t - 12)) then
    raise exception 'FAIL ip journal not moved';
  end if;
  if (select string_agg(e->>'date', ',') from public.sales, jsonb_array_elements(payments) e where id = sx) <> (t - 12)::text then
    raise exception 'FAIL ip payments JSON: %', (select payments from public.sales where id = sx);
  end if;
  if (select doc_date from public.sales where id = sx) <> t - 15 then raise exception 'FAIL ip moved the invoice'; end if;
  -- Idempotent; the chatter is on the invoice.
  r := public.apply_document_date_change('invoice_payment', ip, t - 12, 'Paid on the 12th, booked late');
  if not coalesce((r->>'already_applied')::boolean, false) then raise exception 'FAIL ip not idempotent: %', r; end if;
end $$;
reset role;
do $$ begin
  if to_regclass('public.mail_messages') is not null and not exists (
    select 1 from public.mail_messages where res_model = 'sales' and res_id = (select id from dd_ids where k = 'sx') and body like 'Ödənişin tarixi%') then
    raise exception 'FAIL ip chatter not on the invoice';
  end if;
end $$;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00dd-00000000000a","role":"authenticated"}', false);

-- ── Partner payment ──────────────────────────────────────────────────────────
do $$
declare
  t date := public.document_today();
  pp uuid := (select id from dd_ids where k = 'pp');
  p jsonb;
  r jsonb;
begin
  -- Blocked (R6): after the till spent it (T-7).
  p := public.preview_document_date_change('partner_payment', pp, t - 6);
  if (p->>'ok')::boolean or not ('cash_negative' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL pp R6: %', p; end if;
  -- Passes: T-11; the payments row, its cash row and its journal move, the time of day stays.
  r := public.apply_document_date_change('partner_payment', pp, t - 11, 'Receipt dated the day before');
  if not (r->>'ok')::boolean then raise exception 'FAIL pp apply: %', r; end if;
  if (select pg_temp.day(payment_date) from public.payments where id = pp) <> t - 11 then raise exception 'FAIL pp payment_date not moved'; end if;
  if ((select payment_date from public.payments where id = pp) at time zone 'Asia/Baku')::time <> time '11:30' then
    raise exception 'FAIL pp time of day not kept';
  end if;
  if exists (select 1 from public.transactions where source_type = 'partner_payment' and source_id = pp and pg_temp.day(transaction_date) <> t - 11) then
    raise exception 'FAIL pp cash row not moved';
  end if;
  if exists (select 1 from public.payments py join public.journal_entries je on je.id = py.journal_entry_id
             where py.id = pp and je.entry_date <> t - 11) then
    raise exception 'FAIL pp journal not moved';
  end if;
end $$;

-- ── Manual cash row ──────────────────────────────────────────────────────────
do $$
declare
  t date := public.document_today();
  mc1 uuid := (select id from dd_ids where k = 'mc1');
  p jsonb;
  r jsonb;
begin
  -- Blocked (R6): spending the 40 before it came in (T-12).
  p := public.preview_document_date_change('cash_transaction', mc1, t - 13);
  if (p->>'ok')::boolean or not ('cash_negative' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL mc R6: %', p; end if;
  -- Passes: later.
  r := public.apply_document_date_change('cash_transaction', mc1, t - 6, 'Receipt was from the 6th');
  if not (r->>'ok')::boolean then raise exception 'FAIL mc apply: %', r; end if;
  if (select pg_temp.day(transaction_date) from public.transactions where id = mc1) <> t - 6 then raise exception 'FAIL mc not moved'; end if;
  -- W2: another month is a warning to tick (40 days back is always another month).
  p := public.preview_document_date_change('cash_transaction', (select id from dd_ids where k = 'mc2'), t - 47);
  if not ('other_month' = any (pg_temp.codes(p, 'warnings'))) then raise exception 'FAIL mc W2: %', p; end if;
  -- A document that is not a manual cash row is not one.
  p := public.preview_document_date_change('cash_transaction', (select id from dd_ids where k = 'ip'), t - 13);
  if not ('not_posted' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL mc type guard: %', p; end if;
end $$;

-- ── Company-paid expense with the VAT split ─────────────────────────────────
do $$
declare
  t date := public.document_today();
  ex uuid := (select id from dd_ids where k = 'ex');
  p jsonb;
  r jsonb;
begin
  -- Blocked (R6 on the VAT account): EV only gets its 18 on T-5.
  p := public.preview_document_date_change('expense', ex, t - 6);
  if (p->>'ok')::boolean or not ('cash_negative' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL ex R6: %', p; end if;
  if not exists (select 1 from jsonb_array_elements(p->'blockers') b, jsonb_array_elements(b->'details'->'items') i
                 where b->>'code' = 'cash_negative' and (i->>'account_id')::uuid = '00000000-0000-0000-00dd-0000000000a4') then
    raise exception 'FAIL ex R6 not on the VAT account: %', p;
  end if;
  -- Passes: T-4. Both cash rows and the journal move, and the header.
  p := public.preview_document_date_change('expense', ex, t - 4);
  if not (p->>'ok')::boolean or (p->'affected'->>'cash')::int <> 2 then raise exception 'FAIL ex T-4: %', p; end if;
  r := public.apply_document_date_change('expense', ex, t - 4, 'Invoice date of the consultant');
  if not (r->>'ok')::boolean then raise exception 'FAIL ex apply: %', r; end if;
  if (select expense_date from public.expenses where id = ex) <> t - 4 then raise exception 'FAIL ex header not moved'; end if;
  if exists (select 1 from public.transactions where source_type = 'expense' and source_id = ex and pg_temp.day(transaction_date) <> t - 4) then
    raise exception 'FAIL ex cash rows not moved';
  end if;
  if exists (select 1 from public.journal_entries where source_type = 'expense' and source_id = ex and entry_date <> t - 4) then
    raise exception 'FAIL ex journal not moved';
  end if;
end $$;

-- ── Employee-paid expense ────────────────────────────────────────────────────
do $$
declare
  t date := public.document_today();
  ee uuid := (select id from dd_ids where k = 'ee');
  v_reimb uuid := (select reimbursement_journal_id from public.expenses where id = (select id from dd_ids where k = 'ee'));
  p jsonb;
  r jsonb;
begin
  -- Blocked (R7): after its reimbursement (T-9).
  p := public.preview_document_date_change('expense', ee, t - 8);
  if (p->>'ok')::boolean or not ('reimbursement_before_expense' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL ee R7: %', p; end if;
  -- Passes: earlier. The approval journal moves; the reimbursement stays on T-9.
  r := public.apply_document_date_change('expense', ee, t - 11, 'Taxi was on the 11th');
  if not (r->>'ok')::boolean then raise exception 'FAIL ee apply: %', r; end if;
  if (select expense_date from public.expenses where id = ee) <> t - 11 then raise exception 'FAIL ee header not moved'; end if;
  if exists (select 1 from public.journal_entries where source_type = 'expense' and source_id = ee and id <> v_reimb and entry_date <> t - 11) then
    raise exception 'FAIL ee approval journal not moved';
  end if;
  if (select entry_date from public.journal_entries where id = v_reimb) <> t - 9 then raise exception 'FAIL ee reimbursement moved'; end if;
  if exists (select 1 from public.transactions where source_type = 'expense' and source_id = ee and pg_temp.day(transaction_date) <> t - 9) then
    raise exception 'FAIL ee reimbursement cash moved';
  end if;
end $$;

-- ── R1: a finance user who is not an admin ──────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00dd-00000000000e","role":"authenticated"}', false);
do $$
declare
  t date := public.document_today();
  p jsonb;
begin
  p := public.preview_document_date_change('partner_payment', (select id from dd_ids where k = 'pp'), t - 12);
  if not ('not_admin' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL R1 preview: %', p; end if;
  if public.resolve_date_change_document((select id from dd_ids where k = 'mc2')) is not null then raise exception 'FAIL R1 resolve'; end if;
  begin
    perform public.apply_document_date_change('expense', (select id from dd_ids where k = 'ex'), t - 5, 'test');
    raise exception 'FAIL R1 apply allowed for a non-admin';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00dd-00000000000a","role":"authenticated"}', false);

-- ── R2: a closed period ──────────────────────────────────────────────────────
reset role;
insert into public.accounting_periods (period_year, period_month, status) values (2025, 3, 'closed') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00dd-00000000000a","role":"authenticated"}', false);
do $$
declare
  p jsonb;
begin
  p := public.preview_document_date_change('cash_transaction', (select id from dd_ids where k = 'mc2'), date '2025-03-10');
  if not ('period_closed_new' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL R2 cash: %', p; end if;
  p := public.preview_document_date_change('expense', (select id from dd_ids where k = 'ex'), date '2025-03-10');
  if not ('period_closed_new' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL R2 expense: %', p; end if;
end $$;
reset role;

-- ── Grants; the sale/purchase handlers are unchanged ────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.resolve_date_change_document(uuid)', 'execute') then raise exception 'FAIL anon may resolve'; end if;
  if has_function_privilege('authenticated', 'public._date_change_set_header(text, uuid, date, date, jsonb, jsonb)', 'execute') then
    raise exception 'FAIL internal helper exposed';
  end if;
  if (select count(*) from public.document_date_changes where document_type in ('invoice_payment', 'partner_payment', 'cash_transaction', 'expense')) <> 5 then
    raise exception 'FAIL audit rows: %', (select count(*) from public.document_date_changes);
  end if;
end $$;

select 'ALL CHECKS PASSED';
