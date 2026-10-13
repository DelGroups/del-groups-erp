#!/usr/bin/env bash
# Rehearsal of plans and limits on local Postgres (prompt 12), no Supabase:
#   1. a platform admin saves a 5-user plan and gives tenant "acme" a subscription
#      (public.save_plan / public.save_subscription, as the admin, under RLS);
#   2. the usage job (scripts/tenants/usage-snapshot.ts --local) records a snapshot, reports
#      what is at 80 % / 100 % and copies modules and limits to the tenant database;
#   3. in the tenant database a 5th user can be added, a 6th cannot (trigger), uploads stop
#      at the storage limit, and the limit status shows the AI warning;
#   4. after the subscription is cancelled and the job runs again, the limits are gone.
#
#   PG_BASE_URL=postgresql://postgres@127.0.0.1:55432 scripts/tenants/e2e-limits.sh
#
# Drops and re-creates only the databases lim_cp and lim_acme.
# BUILD_FRESH overrides scripts/db/build-fresh.sh (e.g. a copy with a Windows-style ROOT).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE="${PG_BASE_URL:-postgresql://postgres@127.0.0.1:55432}"
BASE="${BASE%/}"
BUILD_FRESH="${BUILD_FRESH:-$ROOT/scripts/db/build-fresh.sh}"
if [[ "$BASE" == *supabase.co* || "$BASE" == *supabase.com* ]]; then
  echo "Refusing: PG_BASE_URL must be a local Postgres, not Supabase." >&2
  exit 1
fi
export PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
q() { psql -X -q -At -v ON_ERROR_STOP=1 "$1" -c "$2"; }
fail() { echo "E2E LIMITS FAILED: $*" >&2; exit 1; }
CP="$BASE/lim_cp"; ACME="$BASE/lim_acme"
ADMIN="aaaaaaaa-0000-0000-0000-00000000000a"
# Runs SQL in the control plane as the signed-in platform admin (RLS applies).
as_admin() {
  psql -X -q -At -v ON_ERROR_STOP=1 "$CP" <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$ADMIN","role":"authenticated"}', true);
$1
commit;
SQL
}
usage_job() {
  (cd "$ROOT" && CONTROL_PLANE_DB_URL="$CP" TENANT_DATABASE_URLS="{\"acme\":\"$ACME\"}" \
    node --import ./scripts/node-ts/register.mjs scripts/tenants/usage-snapshot.ts --local 2>&1 \
    | grep -v -e ExperimentalWarning -e MODULE_TYPELESS -e Reparsing -e 'To eliminate' -e trace-warnings)
}
add_user() { q "$ACME" "insert into auth.users (id, email) values (gen_random_uuid(), '$1')"; }

for db in lim_cp lim_acme; do
  "${PSQL[@]}" "$BASE/postgres" -c "drop database if exists $db with (force)" -c "create database $db"
done

echo "== Tenant database (baseline + modules + newer migrations, incl. tenant_limits)"
DATABASE_URL="$ACME" "$BUILD_FRESH" --plain-postgres > /dev/null
for i in 1 2 3 4; do add_user "user$i@acme.test"; done
echo "  4 active users"

echo "== Control plane"
"${PSQL[@]}" "$CP" -f "$ROOT/scripts/db/supabase-shim.sql"
"${PSQL[@]}" "$CP" -f "$ROOT/control-panel/supabase/tests/vault-shim.sql"
for f in "$ROOT"/control-panel/supabase/migrations/*.sql; do "${PSQL[@]}" "$CP" -f "$f"; done
"${PSQL[@]}" "$CP" <<SQL
insert into auth.users (id, email) values ('$ADMIN', 'admin@example.test');
insert into public.platform_admins (user_id, email, role) values ('$ADMIN', 'admin@example.test', 'owner');
with t as (insert into public.tenants (name, slug, status) values ('Acme', 'acme', 'active') returning id)
insert into public.tenant_databases (tenant_id, supabase_project_ref) select id, 'localacme' from t;
SQL

echo
echo "== 1. A 5-user plan and a subscription (as the platform admin)"
PLAN=$(as_admin "select public.save_plan('{\"code\":\"team\",\"name\":\"Team\",\"annual_discount_pct\":17,\"max_users\":5,
  \"included_storage_gb\":0.01,\"included_ai_credit_usd\":1,\"currency\":\"AZN\",\"base_fee\":30,
  \"modules\":[{\"module_id\":\"inventory\",\"amount\":5,\"per_user\":true},{\"module_id\":\"hr\",\"amount\":3,\"per_user\":true}],
  \"addons\":[{\"addon_code\":\"extra_users\",\"amount\":10}]}');" | tail -n 1)
TENANT=$(q "$CP" "select id from public.tenants where slug = 'acme'")
as_admin "select public.save_subscription(jsonb_build_object('tenant_id', '$TENANT', 'plan_id', '$PLAN', 'status', 'active',
  'billing_period', 'monthly', 'user_count', 5, 'current_period_start', '2026-10-01', 'current_period_end', '2026-10-31',
  'modules', '[\"inventory\"]'::jsonb, 'addons', '[]'::jsonb));" > /dev/null
echo "  entitlements: $(q "$CP" "select row_to_json(e) from public.tenant_entitlements('$TENANT') e")"

# Some usage in the tenant: 0.9 USD of AI this month, a 20 MB file (limit 0.01 GB ≈ 10.7 MB).
"${PSQL[@]}" "$ACME" <<'SQL'
insert into public.ai_usage_log (id, user_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, tool_calls, status, created_at)
  select gen_random_uuid(), (select id from public.profiles limit 1), 1, 1, 0, 0, 0.9, 0, 'ok', now();
insert into storage.objects (bucket_id, name, metadata) values ((select id from storage.buckets limit 1), 'e2e/big.bin', '{"size": 20971520}');
SQL

echo
echo "== 2. Daily usage job"
usage_job | sed 's/^/  /' || fail "usage job"
[[ "$(q "$CP" "select active_users || ' ' || storage_bytes || ' ' || ai_cost from public.usage_snapshots where tenant_id = '$TENANT'")" == "4 20971520 0.9000" ]] \
  || fail "snapshot not recorded"
[[ "$(q "$CP" "select sync_status from public.subscriptions where tenant_id = '$TENANT' and status = 'active'")" == synced ]] || fail "not synced"
[[ "$(q "$ACME" "select max_users || ' ' || storage_limit_bytes || ' ' || ai_monthly_limit_usd from public.tenant_limits")" == "5 10737418 1.00" ]] \
  || fail "limits not copied: $(q "$ACME" "select row_to_json(l) from public.tenant_limits l")"
[[ "$(q "$ACME" "select string_agg(module_id, ',' order by module_id) from public.tenant_modules where enabled")" == "core,inventory" ]] \
  || fail "modules not copied"
echo "  snapshot recorded; limits (5 seats, 10 MB, 1 USD) and modules (core, inventory) copied to the tenant"

echo
echo "== 3. Limits inside the tenant database"
add_user "user5@acme.test"
echo "  5th user: added"
if add_user "user6@acme.test" 2> /tmp/e2e-limits-6th.txt; then fail "a 6th user was added"; fi
grep -q seat_limit_reached /tmp/e2e-limits-6th.txt || fail "6th user failed for another reason: $(cat /tmp/e2e-limits-6th.txt)"
echo "  6th user: refused (seat_limit_reached)"
if q "$ACME" "update public.profiles set is_active = false where email = 'user1@acme.test'; update public.profiles set is_active = true where email = 'user1@acme.test'" > /dev/null; then
  echo "  deactivating and re-activating within the 5 seats: allowed"
else fail "re-activation within the limit refused"; fi
[[ "$(q "$ACME" "select public.storage_upload_allowed()")" == f ]] || fail "uploads still allowed above the storage limit"
echo "  uploads: blocked (20 MB of 10 MB used)"
echo "  limit status: $(q "$ACME" "select public.tenant_limit_status()")"

echo
echo "== 4. Cancelled subscription: limits removed"
as_admin "select public.save_subscription(jsonb_build_object('tenant_id', '$TENANT', 'plan_id', '$PLAN', 'status', 'cancelled',
  'billing_period', 'monthly', 'user_count', 5, 'modules', '[]'::jsonb, 'addons', '[]'::jsonb));" > /dev/null
usage_job > /dev/null || fail "usage job after cancel"
[[ "$(q "$ACME" "select count(*) from public.tenant_limits")" == 0 ]] || fail "limits kept after cancel"
add_user "user6@acme.test"
echo "  no limits row; the 6th user can now be added"

rm -f /tmp/e2e-limits-6th.txt
echo
echo "E2E LIMITS PASSED"
