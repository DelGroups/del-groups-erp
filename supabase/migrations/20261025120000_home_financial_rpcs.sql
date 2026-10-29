-- Financial figures of the widget home page (prompt 24b), summed in the database.
--
-- Who: only admins (public.user_is_admin()) and users whose role, or their own overrides, grant
-- dashboard.view_financials (flat key can_view_financials) — public.can_view_financials(), the
-- same rule as canViewFinancials() in the app. Every function's first step raises 'forbidden'
-- (errcode 42501) for anyone else, so a money figure never leaves the database for them.
--
-- What counts (as src/lib/shell/kpis.ts and the classic dashboard):
--   - sales and purchases: every document except cancelled / void / draft / deleted;
--     sales by doc_date, purchases by posted_at (else created_at);
--   - expenses: outgoing cash/bank transactions (type 'Məxaric') by transaction date;
--   - expenses by category: posted expense documents (expenses module);
--   - inventory value: stock × buy price; sheet products keep stock in metres, so their buy price
--     (one sheet) is divided by the sheet length (full_sheet_length_m, else base_length, else 4 m).
-- Cash and bank balances follow the user's allowed_financial_accounts scope (empty = all).
-- Each function checks that its tables exist (a tenant may not have every module) and returns
-- empty figures otherwise. security definer, search_path = public. Safe to re-run.

create or replace function public.can_view_financials()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.user_is_admin(), false) or coalesce((
    select coalesce((r.permissions ->> 'can_view_financials')::boolean, false)
        or coalesce(
             (p.permission_overrides -> '_matrix' -> 'dashboard' ->> 'view_financials')::boolean,
             (r.permissions -> '_matrix' -> 'dashboard' ->> 'view_financials')::boolean,
             false)
      from public.profiles p
      left join public.roles r on r.id = p.role_id
     where p.id = auth.uid() and coalesce(p.is_active, true)
  ), false);
$$;

comment on function public.can_view_financials() is
  'May the signed-in user see the home page''s money figures (prompt 24b)? Admins, or dashboard.view_financials.';

-- Raises 'forbidden' unless the user may see financial figures. First line of every function below.
create or replace function public.home_require_financials()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.can_view_financials() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;

-- A document that counts (not cancelled, void, draft or deleted).
create or replace function public.home_doc_counts(p_status text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select lower(coalesce(p_status, '')) not in ('cancelled', 'canceled', 'void', 'voided', 'draft', 'deleted');
$$;

-- ── Summary of a period ──────────────────────────────────────────────────────

create or replace function public.home_financial_summary(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sales numeric := 0;
  v_sales_count bigint := 0;
  v_purchases numeric := 0;
  v_purchases_count bigint := 0;
  v_expenses numeric := 0;
  v_income numeric := 0;
begin
  perform public.home_require_financials();
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'invalid period' using errcode = '22023';
  end if;
  if to_regclass('public.sales') is not null then
    select coalesce(sum(s.total_amount), 0), count(*) into v_sales, v_sales_count
      from public.sales s
     where public.home_doc_counts(s.status) and coalesce(s.doc_date, s.created_at::date) between p_from and p_to;
  end if;
  if to_regclass('public.purchases') is not null then
    select coalesce(sum(pu.total_amount), 0), count(*) into v_purchases, v_purchases_count
      from public.purchases pu
     where public.home_doc_counts(pu.status) and coalesce(pu.posted_at, pu.created_at)::date between p_from and p_to;
  end if;
  if to_regclass('public.transactions') is not null then
    select coalesce(sum(t.amount) filter (where t.type = 'Məxaric'), 0),
           coalesce(sum(t.amount) filter (where t.type = 'Mədaxil'), 0)
      into v_expenses, v_income
      from public.transactions t
     where coalesce(t.transaction_date, t.created_at::date) between p_from and p_to;
  end if;
  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'sales_total', round(v_sales, 2), 'sales_count', v_sales_count,
    'purchases_total', round(v_purchases, 2), 'purchases_count', v_purchases_count,
    'expenses_total', round(v_expenses, 2), 'income_total', round(v_income, 2),
    'net_profit', round(v_sales - v_expenses, 2)
  );
end;
$$;

-- ── Series (trend chart, sparkline) ─────────────────────────────────────────

create or replace function public.home_financial_series(p_from date, p_to date, p_bucket text default 'day')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_bucket text := case when p_bucket in ('day', 'week', 'month') then p_bucket else 'day' end;
  v_rows jsonb;
begin
  perform public.home_require_financials();
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 800 then
    raise exception 'invalid period' using errcode = '22023';
  end if;
  with buckets as (
    select generate_series(date_trunc(v_bucket, p_from::timestamp), date_trunc(v_bucket, p_to::timestamp), ('1 ' || v_bucket)::interval)::date as b
  ), s as (
    select date_trunc(v_bucket, coalesce(x.doc_date, x.created_at::date)::timestamp)::date as b, sum(x.total_amount) as total, count(*) as n
      from public.sales x
     where public.home_doc_counts(x.status) and coalesce(x.doc_date, x.created_at::date) between p_from and p_to
     group by 1
  ), e as (
    select date_trunc(v_bucket, coalesce(t.transaction_date, t.created_at::date)::timestamp)::date as b, sum(t.amount) as total
      from public.transactions t
     where t.type = 'Məxaric' and coalesce(t.transaction_date, t.created_at::date) between p_from and p_to
     group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'bucket', buckets.b,
           'sales', round(coalesce(s.total, 0), 2),
           'sales_count', coalesce(s.n, 0),
           'expenses', round(coalesce(e.total, 0), 2)
         ) order by buckets.b), '[]'::jsonb)
    into v_rows
    from buckets left join s on s.b = buckets.b left join e on e.b = buckets.b;
  return v_rows;
end;
$$;

-- ── Cash and bank balances (allowed_financial_accounts scope) ───────────────

create or replace function public.home_account_balances()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_allowed jsonb;
  v_rows jsonb;
begin
  perform public.home_require_financials();
  if to_regclass('public.accounts') is null then
    return '[]'::jsonb;
  end if;
  if not public.user_is_admin() then
    select case
             when jsonb_typeof(p.scope_overrides -> 'allowed_financial_accounts') = 'array' and jsonb_array_length(p.scope_overrides -> 'allowed_financial_accounts') > 0
               then p.scope_overrides -> 'allowed_financial_accounts'
             when jsonb_typeof(r.scopes -> 'allowed_financial_accounts') = 'array'
               then r.scopes -> 'allowed_financial_accounts'
             else '[]'::jsonb
           end
      into v_allowed
      from public.profiles p left join public.roles r on r.id = p.role_id
     where p.id = auth.uid();
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'type', a.type, 'balance', round(coalesce(a.balance, 0), 2)) order by a.name), '[]'::jsonb)
    into v_rows
    from public.accounts a
   where coalesce(a.is_vat_account, false) = false
     and (coalesce(jsonb_array_length(v_allowed), 0) = 0 or v_allowed ? a.id::text);
  return v_rows;
end;
$$;

-- ── Receivables (ageing) and payables due ───────────────────────────────────

create or replace function public.home_receivables(p_today date default current_date, p_top integer default 5)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_buckets jsonb;
  v_top jsonb;
  v_total numeric;
begin
  perform public.home_require_financials();
  if to_regclass('public.sales') is null then
    return jsonb_build_object('total', 0, 'buckets', '[]'::jsonb, 'top', '[]'::jsonb);
  end if;
  with dues as (
    select s.customer_id, coalesce(nullif(s.customer_name, ''), '—') as customer_name,
           greatest(coalesce(s.remaining_balance, 0), 0) as due,
           greatest(coalesce(p_today, current_date) - coalesce(s.doc_date, s.created_at::date), 0) as age
      from public.sales s
     where public.home_doc_counts(s.status) and coalesce(s.remaining_balance, 0) > 0
  ), b as (
    select case when age <= 30 then '0_30' when age <= 60 then '31_60' when age <= 90 then '61_90' else '90_plus' end as bucket, sum(due) as amount, count(*) as n
      from dues group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('bucket', x.k, 'amount', round(coalesce(b.amount, 0), 2), 'count', coalesce(b.n, 0)) order by x.ord), '[]'::jsonb),
         (select round(coalesce(sum(due), 0), 2) from dues)
    into v_buckets, v_total
    from (values ('0_30', 1), ('31_60', 2), ('61_90', 3), ('90_plus', 4)) as x(k, ord)
    left join b on b.bucket = x.k;
  with dues as (
    select s.customer_id, coalesce(nullif(s.customer_name, ''), '—') as customer_name, greatest(coalesce(s.remaining_balance, 0), 0) as due
      from public.sales s
     where public.home_doc_counts(s.status) and coalesce(s.remaining_balance, 0) > 0
  ), t as (
    select customer_id, min(customer_name) as customer_name, sum(due) as amount, count(*) as n
      from dues group by customer_id
     order by sum(due) desc
     limit greatest(1, least(coalesce(p_top, 5), 20))
  )
  select coalesce(jsonb_agg(jsonb_build_object('customer_id', customer_id, 'name', customer_name, 'amount', round(amount, 2), 'count', n) order by amount desc), '[]'::jsonb)
    into v_top from t;
  return jsonb_build_object('total', v_total, 'buckets', v_buckets, 'top', v_top);
end;
$$;

create or replace function public.home_payables_due(p_today date default current_date, p_days integer default 14)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := coalesce(p_today, current_date);
  v_rows jsonb;
  v_due numeric;
  v_overdue numeric;
begin
  perform public.home_require_financials();
  if to_regclass('public.purchases') is null then
    return jsonb_build_object('due_total', 0, 'overdue_total', 0, 'items', '[]'::jsonb);
  end if;
  select round(coalesce(sum(pu.debt_amount) filter (where pu.due_date between v_today and v_today + greatest(1, least(coalesce(p_days, 14), 90))), 0), 2),
         round(coalesce(sum(pu.debt_amount) filter (where pu.due_date < v_today), 0), 2)
    into v_due, v_overdue
    from public.purchases pu
   where public.home_doc_counts(pu.status) and coalesce(pu.debt_amount, 0) > 0;
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'number', x.invoice_number, 'supplier_id', x.supplier_id, 'supplier', x.supplier, 'due_date', x.due_date, 'amount', round(x.debt_amount, 2)) order by x.due_date), '[]'::jsonb)
    into v_rows
    from (
      select pu.id, pu.invoice_number, pu.supplier_id, pu.due_date, pu.debt_amount,
             (select coalesce(nullif(sp.company_name, ''), sp.full_name) from public.suppliers sp where sp.id = pu.supplier_id) as supplier
        from public.purchases pu
       where public.home_doc_counts(pu.status) and coalesce(pu.debt_amount, 0) > 0
         and pu.due_date <= v_today + greatest(1, least(coalesce(p_days, 14), 90))
       order by pu.due_date
       limit 10
    ) x;
  return jsonb_build_object('due_total', v_due, 'overdue_total', v_overdue, 'items', v_rows);
end;
$$;

-- ── Leaderboards (top customers, top products, salespeople) ─────────────────

-- Top customers or products by revenue in a period, with their rank in the period before it
-- (same length) for the rank movement. p_kind: 'customers' | 'products'.
create or replace function public.home_top_revenue(p_kind text, p_from date, p_to date, p_limit integer default 5)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_len integer := p_to - p_from + 1;
  v_prev_from date := p_from - (p_to - p_from + 1);
  v_prev_to date := p_from - 1;
  v_limit integer := greatest(1, least(coalesce(p_limit, 5), 20));
  v_rows jsonb;
begin
  perform public.home_require_financials();
  if p_from is null or p_to is null or v_len < 1 or v_len > 800 then
    raise exception 'invalid period' using errcode = '22023';
  end if;
  if to_regclass('public.sales') is null then
    return '[]'::jsonb;
  end if;
  if p_kind = 'customers' then
    with r as (
      select s.customer_id as key, min(coalesce(nullif(s.customer_name, ''), '—')) as name,
             sum(s.total_amount) filter (where coalesce(s.doc_date, s.created_at::date) between p_from and p_to) as cur,
             sum(s.total_amount) filter (where coalesce(s.doc_date, s.created_at::date) between v_prev_from and v_prev_to) as prev
        from public.sales s
       where public.home_doc_counts(s.status) and coalesce(s.doc_date, s.created_at::date) between v_prev_from and p_to
       group by s.customer_id
    ), ranked as (
      select key, name, coalesce(cur, 0) as cur,
             rank() over (order by coalesce(cur, 0) desc) as rank_now,
             case when coalesce(prev, 0) > 0 then rank() over (order by coalesce(prev, 0) desc) end as rank_prev_raw,
             coalesce(prev, 0) as prev
        from r
    )
    select coalesce(jsonb_agg(jsonb_build_object('key', key, 'name', name, 'amount', round(cur, 2), 'rank', rank_now, 'previous_rank', case when prev > 0 then rank_prev_raw end) order by rank_now), '[]'::jsonb)
      into v_rows
      from (select * from ranked where cur > 0 order by rank_now limit v_limit) x;
  elsif p_kind = 'products' then
    if to_regclass('public.sale_items') is null then
      return '[]'::jsonb;
    end if;
    with r as (
      select coalesce(si.product_id::text, si.product_name) as key, min(coalesce(nullif(si.product_name, ''), '—')) as name,
             sum(coalesce(si.line_total, si.total_amount, si.total_price, si.quantity * si.unit_price, 0)) filter (where coalesce(s.doc_date, s.created_at::date) between p_from and p_to) as cur,
             sum(coalesce(si.line_total, si.total_amount, si.total_price, si.quantity * si.unit_price, 0)) filter (where coalesce(s.doc_date, s.created_at::date) between v_prev_from and v_prev_to) as prev
        from public.sale_items si
        join public.sales s on s.id = si.sale_id
       where public.home_doc_counts(s.status) and coalesce(s.doc_date, s.created_at::date) between v_prev_from and p_to
       group by 1
    ), ranked as (
      select key, name, coalesce(cur, 0) as cur, coalesce(prev, 0) as prev,
             rank() over (order by coalesce(cur, 0) desc) as rank_now,
             rank() over (order by coalesce(prev, 0) desc) as rank_prev_raw
        from r
    )
    select coalesce(jsonb_agg(jsonb_build_object('key', key, 'name', name, 'amount', round(cur, 2), 'rank', rank_now, 'previous_rank', case when prev > 0 then rank_prev_raw end) order by rank_now), '[]'::jsonb)
      into v_rows
      from (select * from ranked where cur > 0 order by rank_now limit v_limit) x;
  else
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  return v_rows;
end;
$$;

create or replace function public.home_sales_by_seller(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  perform public.home_require_financials();
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'invalid period' using errcode = '22023';
  end if;
  if to_regclass('public.sales') is null then
    return '[]'::jsonb;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('seller_id', seller_id, 'name', name, 'amount', round(total, 2), 'count', n) order by total desc), '[]'::jsonb)
    into v_rows
    from (
      select coalesce(s.seller_id, s.salesperson_id) as seller_id, min(coalesce(nullif(s.seller_name, ''), '—')) as name, sum(s.total_amount) as total, count(*) as n
        from public.sales s
       where public.home_doc_counts(s.status) and coalesce(s.doc_date, s.created_at::date) between p_from and p_to
       group by 1
       order by 3 desc
       limit 10
    ) x;
  return v_rows;
end;
$$;

-- ── Expenses by category (expenses module) ──────────────────────────────────

create or replace function public.home_expenses_by_category(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  perform public.home_require_financials();
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'invalid period' using errcode = '22023';
  end if;
  if to_regclass('public.expenses') is null then
    return '[]'::jsonb;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('category', category, 'amount', round(total, 2), 'count', n) order by total desc), '[]'::jsonb)
    into v_rows
    from (
      select coalesce(nullif(e.category, ''), '—') as category, sum(e.amount) as total, count(*) as n
        from public.expenses e
       where lower(coalesce(e.status, 'posted')) in ('posted', 'approved', 'reimbursed', 'paid')
         and e.cancelled_at is null
         and coalesce(e.expense_date, e.created_at::date) between p_from and p_to
       group by 1
       order by 2 desc
       limit 12
    ) x;
  return v_rows;
end;
$$;

-- ── Inventory value ─────────────────────────────────────────────────────────

create or replace function public.home_inventory_value()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_value numeric := 0;
  v_items bigint := 0;
begin
  perform public.home_require_financials();
  if to_regclass('public.products') is null then
    return jsonb_build_object('value', 0, 'products', 0);
  end if;
  select coalesce(sum(greatest(coalesce(p.stock, 0), 0) *
           case when p.inventory_mode = 'polywood' or p.is_dimensional is true
                then coalesce(p.buy_price, 0) / coalesce(nullif(p.full_sheet_length_m, 0), nullif(p.base_length, 0), 4)
                else coalesce(p.buy_price, 0) end), 0),
         count(*) filter (where coalesce(p.stock, 0) > 0)
    into v_value, v_items
    from public.products p
   where coalesce(p.is_service, false) = false;
  return jsonb_build_object('value', round(v_value, 2), 'products', v_items);
end;
$$;

-- ── Week over week ──────────────────────────────────────────────────────────

-- The last 7 days (ending p_today) against the 7 days before: sales, purchases, expenses, new customers.
create or replace function public.home_week_over_week(p_today date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := coalesce(p_today, current_date);
  v_cur jsonb;
  v_prev jsonb;
  v_new_cur bigint := 0;
  v_new_prev bigint := 0;
begin
  perform public.home_require_financials();
  v_cur := public.home_financial_summary(v_today - 6, v_today);
  v_prev := public.home_financial_summary(v_today - 13, v_today - 7);
  if to_regclass('public.customers') is not null then
    select count(*) filter (where c.created_at::date between v_today - 6 and v_today),
           count(*) filter (where c.created_at::date between v_today - 13 and v_today - 7)
      into v_new_cur, v_new_prev
      from public.customers c
     where c.created_at::date between v_today - 13 and v_today;
  end if;
  return jsonb_build_object(
    'current', v_cur || jsonb_build_object('new_customers', v_new_cur),
    'previous', v_prev || jsonb_build_object('new_customers', v_new_prev)
  );
end;
$$;

-- ── CRM: pipeline value and this month's targets (prompt 21 tables) ─────────

create or replace function public.home_crm_money(p_month date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_stages jsonb := '[]'::jsonb;
  v_targets jsonb := '[]'::jsonb;
begin
  perform public.home_require_financials();
  if to_regclass('public.deals') is null or to_regclass('public.crm_stages') is null or to_regclass('public.crm_targets') is null then
    return jsonb_build_object('available', false, 'stages', v_stages, 'targets', v_targets);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('stage_id', x.id, 'name', x.name, 'color', x.color, 'count', x.n, 'value', round(x.total, 2), 'weighted', round(x.weighted, 2)) order by x.sequence), '[]'::jsonb)
    into v_stages
    from (
      select st.id, st.name, st.color, st.sequence, count(d.id) as n, coalesce(sum(d.expected_value), 0) as total,
             coalesce(sum(d.expected_value * coalesce(d.probability, 0) / 100), 0) as weighted
        from public.crm_stages st
        left join public.deals d on d.stage_id = st.id and d.type = 'opportunity'
       where not st.is_lost
       group by st.id
    ) x;
  select coalesce(jsonb_agg(jsonb_build_object('team_id', t.team_id, 'user_id', t.user_id, 'target', t.amount, 'won', round(coalesce((
             select sum(d.expected_value) from public.deals d join public.crm_stages s on s.id = d.stage_id
              where s.is_won and d.team_id = t.team_id and (t.user_id is null or d.assigned_to = t.user_id)
                and date_trunc('month', d.won_at)::date = v_month), 0), 2))), '[]'::jsonb)
    into v_targets
    from public.crm_targets t
   where t.month = v_month;
  return jsonb_build_object('available', true, 'stages', v_stages, 'targets', v_targets);
end;
$$;

-- ── Rights ──────────────────────────────────────────────────────────────────

revoke all on function public.home_require_financials(), public.home_doc_counts(text) from public, anon;
revoke all on function
  public.can_view_financials(),
  public.home_financial_summary(date, date),
  public.home_financial_series(date, date, text),
  public.home_account_balances(),
  public.home_receivables(date, integer),
  public.home_payables_due(date, integer),
  public.home_top_revenue(text, date, date, integer),
  public.home_sales_by_seller(date, date),
  public.home_expenses_by_category(date, date),
  public.home_inventory_value(),
  public.home_week_over_week(date),
  public.home_crm_money(date)
from public, anon;
grant execute on function
  public.can_view_financials(),
  public.home_require_financials(),
  public.home_doc_counts(text),
  public.home_financial_summary(date, date),
  public.home_financial_series(date, date, text),
  public.home_account_balances(),
  public.home_receivables(date, integer),
  public.home_payables_due(date, integer),
  public.home_top_revenue(text, date, date, integer),
  public.home_sales_by_seller(date, date),
  public.home_expenses_by_category(date, date),
  public.home_inventory_value(),
  public.home_week_over_week(date),
  public.home_crm_money(date)
to authenticated, service_role;
