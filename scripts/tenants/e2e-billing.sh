#!/usr/bin/env bash
# Rehearsal of invoicing and dunning on local Postgres (prompt 13), no Supabase:
#   1. the billing migration marks an existing "del-groups" tenant exempt;
#   2. a platform admin fills in the seller and bank details and gives "acme" a subscription
#      with automatic billing (Del Groups gets one too, and must stay untouched);
#   3. the billing job (scripts/tenants/billing-run.ts --local --today …) runs on chosen days:
#      the renewal invoice is issued 7 days early (PDF, email), then the unpaid invoice walks
#      acme through past_due → read_only → suspended, and the ERP lookup sees each status;
#   4. the admin records the payments and the next run makes acme active again.
#
#   PG_BASE_URL=postgresql://postgres@127.0.0.1:55432 scripts/tenants/e2e-billing.sh
#
# Drops and re-creates only the database bill_cp. Writes PDFs and the email outbox to a
# temporary folder.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE="${PG_BASE_URL:-postgresql://postgres@127.0.0.1:55432}"
BASE="${BASE%/}"
if [[ "$BASE" == *supabase.co* || "$BASE" == *supabase.com* ]]; then
  echo "Refusing: PG_BASE_URL must be a local Postgres, not Supabase." >&2
  exit 1
fi
export PGOPTIONS="-c client_min_messages=warning"
export PGCLIENTENCODING=UTF8
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
q() { psql -X -q -At -v ON_ERROR_STOP=1 "$1" -c "$2"; }
fail() { echo "E2E BILLING FAILED: $*" >&2; exit 1; }
CP="$BASE/bill_cp"
ADMIN="aaaaaaaa-0000-0000-0000-00000000000b"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
OUTBOX="$WORK/outbox.jsonl"
PDFS="$WORK/pdfs"

as_admin() {
  psql -X -q -At -v ON_ERROR_STOP=1 "$CP" <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$ADMIN","role":"authenticated"}', true);
$1
commit;
SQL
}
billing_on() {
  local rc=0
  (cd "$ROOT" && CONTROL_PLANE_DB_URL="$CP" BILLING_LOCAL_PDF_DIR="$PDFS" BILLING_LOCAL_OUTBOX="$OUTBOX" \
    node --import ./scripts/node-ts/register.mjs scripts/tenants/billing-run.ts --local --today "$1") > "$WORK/run.txt" 2>&1 || rc=$?
  [[ $rc == 0 ]] || { cat "$WORK/run.txt" >&2; fail "billing run on $1"; }
  # The run's own event lines ("[acme] …"), without the summary table.
  grep '^\[' "$WORK/run.txt" || true
}
status() { q "$CP" "select status from public.tenants where slug = '$1'"; }
# What the ERP's proxy gets for the tenant's domain (src/lib/tenant/resolve.ts applies it).
erp_status() { q "$CP" "set role service_role; select status from public.erp_tenant_runtime('$1.erp.test');"; }
expect_status() {
  local day="$1" want="$2" got erp
  billing_on "$day" | sed 's/^/    /'
  got="$(status acme)"; erp="$(erp_status acme)"
  [[ "$got" == "$want" && "$erp" == "$want" ]] || fail "$day: acme is $got (ERP sees $erp), expected $want"
  echo "  $day  acme: $got"
}

"${PSQL[@]}" "$BASE/postgres" -c "drop database if exists bill_cp with (force)" -c "create database bill_cp"

echo "== 1. Control plane; the billing migration marks del-groups exempt"
"${PSQL[@]}" "$CP" -f "$ROOT/scripts/db/supabase-shim.sql"
"${PSQL[@]}" "$CP" -f "$ROOT/control-panel/supabase/tests/vault-shim.sql"
BILLING_MIGRATION="$ROOT/control-panel/supabase/migrations/20261015100000_billing.sql"
for f in "$ROOT"/control-panel/supabase/migrations/*.sql; do [[ "$f" == "$BILLING_MIGRATION" ]] || "${PSQL[@]}" "$CP" -f "$f"; done
"${PSQL[@]}" "$CP" <<SQL
insert into auth.users (id, email) values ('$ADMIN', 'admin@example.test');
insert into public.platform_admins (user_id, email, role) values ('$ADMIN', 'admin@example.test', 'owner');
insert into public.tenants (name, slug, status, language) values ('Del Groups', 'del-groups', 'active', 'az'), ('Acme MMC', 'acme', 'active', 'en');
insert into public.tenant_domains (tenant_id, domain, is_primary) select id, slug || '.erp.test', true from public.tenants;
grant select, insert, update, delete on all tables in schema public to service_role;
SQL
for f in "$ROOT"/control-panel/supabase/migrations/*.sql; do "${PSQL[@]}" "$CP" -f "$f"; done
[[ "$(q "$CP" "select string_agg(slug || '=' || billing_exempt, ',' order by slug) from public.tenants")" == "acme=false,del-groups=true" ]] \
  || fail "exemption: $(q "$CP" "select string_agg(slug || '=' || billing_exempt, ',') from public.tenants")"
echo "  del-groups is exempt, acme is not"

echo
echo "== 2. Seller details, a plan, two auto-billed subscriptions (as the platform admin)"
as_admin "update public.billing_settings set seller_name = 'Del Groups MMC', seller_tax_id = '1234567891',
  bank_name = 'Test Bank', bank_account = 'AZ00TEST0000000000000000000', tax_rate_pct = 18;" > /dev/null
PLAN=$(as_admin "select public.save_plan('{\"code\":\"business\",\"name\":\"Business\",\"annual_discount_pct\":17,\"max_users\":25,
  \"currency\":\"AZN\",\"base_fee\":50,\"modules\":[{\"module_id\":\"inventory\",\"amount\":5,\"per_user\":true}],\"addons\":[]}');" | tail -n 1)
for slug in acme del-groups; do
  TID=$(q "$CP" "select id from public.tenants where slug = '$slug'")
  as_admin "select public.save_subscription(jsonb_build_object('tenant_id', '$TID', 'plan_id', '$PLAN', 'status', 'active',
    'billing_period', 'monthly', 'user_count', 5, 'current_period_start', '2026-10-01', 'current_period_end', '2026-11-01',
    'modules', '[\"inventory\"]'::jsonb, 'addons', '[]'::jsonb));
    update public.subscriptions set auto_billing = true where tenant_id = '$TID';
    update public.tenants set billing_email = 'finance@$slug.test' where id = '$TID';" > /dev/null
done
echo "  Business: 50 AZN + 5 users × 5 AZN = 75 AZN a month + 18 % tax = 88.50 AZN"

echo
echo "== 3. The billing job, day by day"
expect_status 2026-10-24 active
[[ "$(q "$CP" "select count(*) from public.invoices")" == 0 ]] || fail "invoiced too early"
expect_status 2026-10-25 active
[[ "$(q "$CP" "select number || ' ' || total || ' ' || due_date || ' ' || status from public.invoices")" == "INV-2026-00001 88.50 2026-11-01 issued" ]] \
  || fail "renewal invoice: $(q "$CP" "select row_to_json(i) from public.invoices i")"
PDF="$(q "$CP" "select pdf_path from public.invoices where number = 'INV-2026-00001'")"
[[ -s "$PDFS/$PDF" && "$(head -c 5 "$PDFS/$PDF")" == "%PDF-" ]] || fail "invoice PDF missing"
grep -q '"subject":"Invoice INV-2026-00001 from Del Groups MMC".*"INV-2026-00001.pdf"' "$OUTBOX" || fail "invoice email: $(cat "$OUTBOX")"
echo "    INV-2026-00001 issued (88.50 AZN, due 2026-11-01), PDF stored, emailed with the PDF"
expect_status 2026-11-01 active
[[ "$(q "$CP" "select current_period_start || ' ' || current_period_end from public.subscriptions s join public.tenants t on t.id = s.tenant_id where t.slug = 'acme'")" == "2026-11-01 2026-12-01" ]] \
  || fail "period did not move on the renewal date"
expect_status 2026-11-02 past_due
expect_status 2026-11-08 past_due
expect_status 2026-11-09 read_only
expect_status 2026-12-08 read_only
expect_status 2026-12-09 suspended
[[ "$(q "$CP" "select string_agg(e.kind || ':' || e.status, ',' order by e.created_at) from public.billing_emails e join public.tenants t on t.id = e.tenant_id where t.slug = 'acme'")" \
  == "invoice_issued:sent,past_due:sent,read_only:sent,invoice_issued:sent,suspended:sent" ]] \
  || fail "emails: $(q "$CP" "select string_agg(kind || ':' || status, ',' order by created_at) from public.billing_emails")"
echo "    emails: invoice, past due, read-only, next invoice (INV-2026-00002), suspended — each once"
[[ "$(q "$CP" "select s.status from public.subscriptions s join public.tenants t on t.id = s.tenant_id where t.slug = 'acme'")" == past_due ]] \
  || fail "subscription not past_due"
[[ "$(status del-groups) $(q "$CP" "select count(*) from public.invoices i join public.tenants t on t.id = i.tenant_id where t.slug = 'del-groups'")" == "active 0" ]] \
  || fail "Del Groups was billed or dunned"
echo "  del-groups: active, never invoiced"

echo
echo "== 4. The admin records the bank transfers; the next run reactivates"
as_admin "select public.record_payment(jsonb_build_object('invoice_id', id, 'amount', total, 'method', 'bank_transfer',
  'provider_reference', 'BANK-' || number)) from public.invoices where status in ('issued', 'overdue') order by number;" > /dev/null
expect_status 2026-12-10 active
[[ "$(q "$CP" "select count(*) from public.invoices where status <> 'paid'")" == 0 ]] || fail "invoices not paid"
grep -q '"subject":"Your ERP is active again"' "$OUTBOX" || fail "no reactivation email"
[[ "$(q "$CP" "select s.status from public.subscriptions s join public.tenants t on t.id = s.tenant_id where t.slug = 'acme'")" == active ]] \
  || fail "subscription not active again"
echo "  payments recorded, acme active again, subscription active, reactivation emailed"
billing_on 2026-12-10 > /dev/null
[[ "$(wc -l < "$OUTBOX" | tr -d ' ')" == 6 ]] || fail "a repeated run sent more emails: $(cat "$OUTBOX")"
echo "  running the same day again sends nothing"

echo
echo "E2E BILLING PASSED"
