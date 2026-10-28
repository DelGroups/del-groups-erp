-- Checks supabase/migrations/20261025110000_home_layouts.sql and
-- 20261025120000_home_financial_rpcs.sql on a database built with
-- scripts/db/build-fresh.sh --plain-postgres (CI: .github/workflows/db-baseline.yml).
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.
-- Leaves test rows behind: run it on a throwaway database only.
--
-- Users: A admin, M manager (no financials), C custom role, G custom role granted
-- dashboard.view_financials, O custom role without it but with a personal override that grants it.

insert into public.roles (id, name, permissions, description, created_at, is_system, scopes) values
  ('00000000-0000-0000-00db-0000000000a0', 'Admin', '{}'::jsonb, null, now(), true, '{}'::jsonb)
on conflict do nothing;
insert into public.roles (id, name, permissions, description, created_at, is_system, scopes) values
  ('00000000-0000-0000-00db-0000000000b0', 'Home test: manager', '{"can_view_dashboard": true, "can_view_sales": true, "can_view_finance": true}'::jsonb, null, now(), false, '{}'::jsonb),
  ('00000000-0000-0000-00db-0000000000c0', 'Home test: staff', '{"can_view_dashboard": true}'::jsonb, null, now(), false, '{}'::jsonb),
  ('00000000-0000-0000-00db-0000000000d0', 'Home test: finance', '{"can_view_dashboard": true, "can_view_financials": true, "_matrix": {"dashboard": {"view": true, "view_financials": true}}}'::jsonb, null, now(), false, '{}'::jsonb)
on conflict (id) do nothing;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-00db-00000000000a', 'home-a@example.test', '{"full_name": "Aysel Admin", "role_name": "Admin"}'),
  ('00000000-0000-0000-00db-00000000000b', 'home-m@example.test', '{"full_name": "Murad Manager", "role_name": "Home test: manager"}'),
  ('00000000-0000-0000-00db-00000000000c', 'home-c@example.test', '{"full_name": "Cavid Staff", "role_name": "Home test: staff"}'),
  ('00000000-0000-0000-00db-00000000000d', 'home-g@example.test', '{"full_name": "Gülnar Finance", "role_name": "Home test: finance"}'),
  ('00000000-0000-0000-00db-00000000000e', 'home-o@example.test', '{"full_name": "Orxan Override", "role_name": "Home test: staff"}')
on conflict (id) do nothing;

update public.profiles set role_id = (select id from public.roles where name = 'Admin' order by is_system desc limit 1) where id = '00000000-0000-0000-00db-00000000000a';
update public.profiles set role_id = '00000000-0000-0000-00db-0000000000b0' where id = '00000000-0000-0000-00db-00000000000b';
update public.profiles set role_id = '00000000-0000-0000-00db-0000000000c0' where id in ('00000000-0000-0000-00db-00000000000c', '00000000-0000-0000-00db-00000000000e');
update public.profiles set role_id = '00000000-0000-0000-00db-0000000000d0' where id = '00000000-0000-0000-00db-00000000000d';
update public.profiles set permission_overrides = '{"_matrix": {"dashboard": {"view_financials": true}}, "_v": 2}'::jsonb where id = '00000000-0000-0000-00db-00000000000e';

-- Data: posted, draft and cancelled sales; a purchase due soon; an outgoing transaction;
-- a normal product and a sheet product (stock in metres, buy price per 4 m sheet).
insert into public.sales (id, doc_no, doc_date, customer_name, total_amount, remaining_balance, status) values
  ('00000000-0000-0000-00db-0000000005a1', 'HT-1', current_date, 'Nərgiz', 100, 40, 'posted'),
  ('00000000-0000-0000-00db-0000000005a2', 'HT-2', current_date - 1, 'Nərgiz', 50, 0, 'posted'),
  ('00000000-0000-0000-00db-0000000005a3', 'HT-3', current_date, 'Draft Ltd', 1000, 1000, 'draft'),
  ('00000000-0000-0000-00db-0000000005a4', 'HT-4', current_date, 'Void Ltd', 2000, 2000, 'cancelled'),
  ('00000000-0000-0000-00db-0000000005a5', 'HT-5', current_date - 75, 'Old Debtor', 30, 30, 'posted')
on conflict (id) do nothing;
insert into public.purchases (id, invoice_number, total_amount, debt_amount, status, due_date, posted_at) values
  ('00000000-0000-0000-00db-0000000006a1', 'HT-P1', 80, 80, 'posted', current_date + 5, now())
on conflict (id) do nothing;
insert into public.accounts (id, code, name, balance) values
  ('00000000-0000-0000-00db-0000000009a1', 'HT-CASH', 'Home test cash', 500)
on conflict do nothing;
insert into public.transactions (id, type, amount, category, transaction_date, account_id) values
  ('00000000-0000-0000-00db-0000000007a1', 'Məxaric', 25, 'Home test', current_date, '00000000-0000-0000-00db-0000000009a1')
on conflict (id) do nothing;
insert into public.products (id, code, name, stock, buy_price, is_service, inventory_mode, full_sheet_length_m) values
  ('00000000-0000-0000-00db-0000000008a1', 'HT-NORMAL', 'Home test normal', 10, 2, false, 'standard', 4),
  ('00000000-0000-0000-00db-0000000008a2', 'HT-SHEET', 'Home test sheet', 8, 100, false, 'polywood', 4)
on conflict (id) do nothing;

-- ── Financial functions: admin, granted role and override see; manager and staff do not ─────
do $$
declare
  v_user uuid;
  v_ok boolean;
  v_fn text;
begin
  foreach v_user in array array['00000000-0000-0000-00db-00000000000b', '00000000-0000-0000-00db-00000000000c']::uuid[] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    if public.can_view_financials() then raise exception 'FAIL % may see financials', v_user; end if;
    foreach v_fn in array array[
      'select public.home_financial_summary(current_date - 30, current_date)',
      'select public.home_financial_series(current_date - 30, current_date, ''day'')',
      'select public.home_account_balances()',
      'select public.home_receivables(current_date, 5)',
      'select public.home_payables_due(current_date, 14)',
      'select public.home_top_revenue(''customers'', current_date - 29, current_date, 5)',
      'select public.home_top_revenue(''products'', current_date - 29, current_date, 5)',
      'select public.home_sales_by_seller(current_date - 29, current_date)',
      'select public.home_expenses_by_category(current_date - 29, current_date)',
      'select public.home_inventory_value()',
      'select public.home_week_over_week(current_date)',
      'select public.home_crm_money(current_date)'
    ] loop
      v_ok := false;
      begin
        execute v_fn;
      exception when insufficient_privilege then
        v_ok := sqlerrm = 'forbidden';
      end;
      if not v_ok then raise exception 'FAIL % ran for %', v_fn, v_user; end if;
    end loop;
  end loop;
end $$;

begin;
set local role authenticated;
do $$
declare
  v_user uuid;
  v_sum jsonb;
  v_inv jsonb;
  v_rec jsonb;
  v_pay jsonb;
begin
  foreach v_user in array array['00000000-0000-0000-00db-00000000000a', '00000000-0000-0000-00db-00000000000d', '00000000-0000-0000-00db-00000000000e']::uuid[] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    if not public.can_view_financials() then raise exception 'FAIL % may not see financials', v_user; end if;
    v_sum := public.home_financial_summary(current_date - 1, current_date);
    -- Only the two posted sales of the last two days count: 100 + 50; drafts and cancelled do not.
    if (v_sum ->> 'sales_count')::int <> 2 or (v_sum ->> 'sales_total')::numeric <> 150 then raise exception 'FAIL summary counted drafts/cancelled: %', v_sum; end if;
    if (v_sum ->> 'expenses_total')::numeric < 25 then raise exception 'FAIL expenses missing: %', v_sum; end if;
  end loop;
  -- Sheet product: 8 m × (100 AZN / 4 m) = 200; normal: 10 × 2 = 20 (other products may exist).
  v_inv := public.home_inventory_value();
  if (v_inv ->> 'value')::numeric < 220 then raise exception 'FAIL inventory value: %', v_inv; end if;
  -- Receivables: 40 now (0-30) and 30 aged 75 days (61-90); drafts and cancelled left out.
  v_rec := public.home_receivables(current_date, 5);
  if (select (b ->> 'amount')::numeric from jsonb_array_elements(v_rec -> 'buckets') b where b ->> 'bucket' = '61_90') < 30 then raise exception 'FAIL ageing: %', v_rec; end if;
  if exists (select 1 from jsonb_array_elements(v_rec -> 'top') x where x ->> 'name' in ('Draft Ltd', 'Void Ltd')) then raise exception 'FAIL cancelled debtor listed: %', v_rec; end if;
  v_pay := public.home_payables_due(current_date, 14);
  if (v_pay ->> 'due_total')::numeric < 80 then raise exception 'FAIL payables due: %', v_pay; end if;
  if jsonb_array_length(public.home_financial_series(current_date - 6, current_date, 'day')) <> 7 then raise exception 'FAIL series length'; end if;
  begin
    perform public.home_financial_series(current_date, current_date - 1, 'day');
    raise exception 'FAIL reversed period accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;
commit;

-- ── Layouts: own row only; company default readable by all, written by admins only ─────
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00db-00000000000c","role":"authenticated"}', true);
do $$
begin
  insert into public.home_layouts (layout) values ('{"v": 1, "columns": {"start": [], "centre": [], "end": []}}');
  if (select count(*) from public.home_layouts where user_id = '00000000-0000-0000-00db-00000000000c') <> 1 then raise exception 'FAIL own layout not saved'; end if;
  begin
    insert into public.home_layouts (user_id, layout) values ('00000000-0000-0000-00db-00000000000b', '{"v": 1}');
    raise exception 'FAIL saved a layout for someone else';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.home_layouts (layout) values ('[]');
    raise exception 'FAIL layout that is not an object';
  exception when check_violation or unique_violation then null;
  end;
  begin
    insert into public.home_layout_defaults (layout) values ('{"v": 1}');
    raise exception 'FAIL staff wrote the company default';
  exception when insufficient_privilege then null;
  end;
end $$;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00db-00000000000a","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.home_layouts where user_id = '00000000-0000-0000-00db-00000000000c') then raise exception 'FAIL admin reads another user''s layout'; end if;
  insert into public.home_layout_defaults (layout) values ('{"v": 1, "columns": {"start": ["greeting"], "centre": ["apps"], "end": []}}')
  on conflict (id) do update set layout = excluded.layout;
  begin
    insert into public.home_layout_defaults (id, layout) values (false, '{"v": 1}');
    raise exception 'FAIL a second default row';
  exception when check_violation then null;
  end;
end $$;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00db-00000000000b","role":"authenticated"}', true);
do $$
begin
  if not exists (select 1 from public.home_layout_defaults) then raise exception 'FAIL manager cannot read the company default'; end if;
  update public.home_layout_defaults set layout = '{"v": 1}';
  if found then raise exception 'FAIL manager changed the company default'; end if;
end $$;
commit;

-- Anonymous visitors have no access.
begin;
set local role anon;
do $$
begin
  perform 1 from public.home_layout_defaults;
  raise exception 'FAIL anon can read the default layout';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  perform public.home_financial_summary(current_date, current_date);
  raise exception 'FAIL anon ran a financial function';
exception when insufficient_privilege then null;
end $$;
commit;

select 'ALL CHECKS PASSED';
