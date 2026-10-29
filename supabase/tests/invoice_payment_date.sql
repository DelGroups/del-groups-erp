-- Checks supabase/migrations/20261017120000_invoice_payment_date.sql on a database built with
-- scripts/db/build-fresh.sh --plain-postgres (CI: .github/workflows/db-baseline.yml).
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.
-- Leaves test rows behind: run it on a throwaway database only.

insert into auth.users (id, email) values
  ('00000000-0000-0000-00bd-000000000001', 'pay-date@example.test')
on conflict do nothing;

insert into public.roles (id, name, permissions) values
  ('00000000-0000-0000-00bd-0000000000a1', 'pay-date-test', '{"can_edit_sales": true, "can_edit_purchases": true}')
on conflict do nothing;

insert into public.profiles (id, role_id, is_active) values
  ('00000000-0000-0000-00bd-000000000001', '00000000-0000-0000-00bd-0000000000a1', true)
on conflict (id) do update set role_id = excluded.role_id, is_active = true;

insert into public.accounts (id, code, name, balance) values
  ('00000000-0000-0000-00bd-0000000000c1', 'PAYDATE', 'Pay date cash', 1000)
on conflict do nothing;

insert into public.customers (id, full_name) values
  ('00000000-0000-0000-00bd-0000000000e1', 'Pay date customer')
on conflict do nothing;

-- Dated before the payments below: a payment may not be earlier than its invoice (fix F1).
insert into public.sales (id, doc_no, customer_id, total_amount, paid_amount, remaining_balance, payments, doc_date) values
  ('00000000-0000-0000-00bd-0000000000f1', 'PD-1', '00000000-0000-0000-00bd-0000000000e1', 300, 0, 300, '[]', current_date - 10)
on conflict do nothing;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00bd-000000000001","role":"authenticated"}', false);

do $$
declare
  v_result jsonb;
  v_tx record;
  v_je record;
  v_payment jsonb;
  v_past date := current_date - 4;
begin
  -- A payment dated four days ago lands on that date in cash, journal and the invoice.
  v_result := public.process_invoice_payment_event(jsonb_build_object(
    'document_type', 'sale',
    'document_id', '00000000-0000-0000-00bd-0000000000f1',
    'amount', 100,
    'account_id', '00000000-0000-0000-00bd-0000000000c1',
    'method', 'Cash',
    'payment_id', 'pd-1',
    'payment_date', v_past::text
  ));
  if (v_result->>'success')::boolean is not true then raise exception 'FAIL payment not recorded: %', v_result; end if;

  select * into v_tx from public.transactions where id = (v_result->>'transaction_id')::uuid;
  -- Back-dated rows carry the payment date in Baku time (document_timestamp).
  if (v_tx.transaction_date at time zone 'Asia/Baku')::date <> v_past then
    raise exception 'FAIL transaction_date % <> %', v_tx.transaction_date, v_past;
  end if;

  select * into v_je from public.journal_entries where id = (v_result->>'journal_entry_id')::uuid;
  if v_je.entry_date <> v_past or (v_je.date at time zone 'Asia/Baku')::date <> v_past then
    raise exception 'FAIL journal entry dated % / %, expected %', v_je.entry_date, v_je.date, v_past;
  end if;

  select p into v_payment from public.sales s, jsonb_array_elements(s.payments) p
  where s.id = '00000000-0000-0000-00bd-0000000000f1' and p->>'id' = 'pd-1';
  if v_payment->>'date' <> v_past::text then raise exception 'FAIL payments[].date = %', v_payment->>'date'; end if;

  -- Without payment_date the payment is dated today, as before.
  v_result := public.process_invoice_payment_event(jsonb_build_object(
    'document_type', 'sale',
    'document_id', '00000000-0000-0000-00bd-0000000000f1',
    'amount', 50,
    'account_id', '00000000-0000-0000-00bd-0000000000c1',
    'payment_id', 'pd-2'
  ));
  select * into v_je from public.journal_entries where id = (v_result->>'journal_entry_id')::uuid;
  if v_je.entry_date <> current_date then raise exception 'FAIL default date %', v_je.entry_date; end if;

  -- A future date is refused.
  begin
    perform public.process_invoice_payment_event(jsonb_build_object(
      'document_type', 'sale',
      'document_id', '00000000-0000-0000-00bd-0000000000f1',
      'amount', 10,
      'account_id', '00000000-0000-0000-00bd-0000000000c1',
      'payment_id', 'pd-3',
      'payment_date', (current_date + 10)::text
    ));
    raise exception 'FAIL future payment date accepted';
  exception when sqlstate '22023' then null;
  end;

  if (select paid_amount from public.sales where id = '00000000-0000-0000-00bd-0000000000f1') <> 150 then
    raise exception 'FAIL paid_amount should be 150';
  end if;
end;
$$;

select 'ALL CHECKS PASSED';
