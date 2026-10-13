#!/usr/bin/env bash
# Rehearsal of docs/runbooks/tenant-1-cutover.md on local Postgres (prompt 11). No Supabase,
# no production: a stand-in for the Del Groups database is built from the production
# snapshot (supabase/baseline) with synthetic business data, in the worst state production
# can be in (no migration history; 20261011150000 applied by hand, the other newer files not).
#
#   PG_BASE_URL=postgresql://postgres@127.0.0.1:55432 scripts/tenants/rehearse-tenant-1.sh
#
# Runs the runbook's database steps with the real files:
#   1 preflight (read-only)          supabase/scripts/tenant1_preflight.sql
#   2 backup + restore to a copy     pg_dump / pg_restore; later steps run on the COPY
#   4 register tenant #1             control-panel/supabase/scripts/register_tenant_1.sql (twice)
#   - what the ERP resolves          scripts/tenants/rehearsal-resolve-check.ts (src/lib/tenant/resolve.ts)
#   5 migration history              supabase/scripts/tenant1_migration_history.sql (twice)
#   6 pending migrations             scripts/tenants/migrate-all.ts --local --tenant del-groups
#   8 verify                         preflight again: no data lost, new tables filled as before
#  10 rollback (restore the backup)  pg_restore into a third database, same data
# The ERP container switch (step 7) and the smoke test need the real server and Supabase;
# tests/tenant1Cutover.test.mjs covers the smoke test against a fake site.
#
# Drops and re-creates only the databases r1_prod, r1_copy, r1_cp and r1_restore.
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
fail() { echo "REHEARSAL FAILED: $*" >&2; exit 1; }
data_section() { "${PSQL[@]}" -At -F ' | ' "$1" -f "$ROOT/supabase/scripts/tenant1_preflight.sql" | grep '^data |'; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
migrate() { (cd "$ROOT" && node --import ./scripts/node-ts/register.mjs scripts/tenants/migrate-all.ts --local "$@" 2>&1 | grep -v -e ExperimentalWarning -e MODULE_TYPELESS -e Reparsing -e 'To eliminate' -e trace-warnings); }

for db in r1_prod r1_copy r1_cp r1_restore; do
  "${PSQL[@]}" "$BASE/postgres" -c "drop database if exists $db with (force)" -c "create database $db"
done
PROD="$BASE/r1_prod"; COPY="$BASE/r1_copy"; CP="$BASE/r1_cp"

echo "== Stand-in for production (baseline = production snapshot, synthetic data)"
DATABASE_URL="$PROD" "$BUILD_FRESH" --plain-postgres --baseline-only > /dev/null
"${PSQL[@]}" "$PROD" -c "drop schema supabase_migrations cascade"   # production never had db push history
"${PSQL[@]}" "$PROD" -f "$ROOT/supabase/migrations/20261011150000_enable_rls_on_remaining_tables.sql" > /dev/null 2>&1  # applied by hand, unrecorded
"${PSQL[@]}" "$PROD" <<'SQL'
set session_replication_role = replica;  -- synthetic rows only: skip posting triggers
insert into public.settings (company_name, voen, address, phone) values ('DEL GROUPS MMC', '1234567890', 'Bakı', '+994 00 000 00 00');
insert into public.company_settings (company_name, voen, address, bank_name, iban, currency, vat_rate)
  values ('DEL GROUPS MMC', '1234567890', 'Bakı', 'Test Bank', 'AZ00TEST0000000000000000', 'AZN', 18);
insert into public.warehouses (id, code, name) values ('00000000-0000-0000-0000-0000000000a1', 'W1', 'Main warehouse');
insert into public.products (id, code, name)
  select ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'P' || g, 'Product ' || g from generate_series(1, 30) g;
insert into public.warehouse_stocks (id, product_id, warehouse_id, current_stock, min_stock_level, updated_at)
  select gen_random_uuid(), id, '00000000-0000-0000-0000-0000000000a1', 10 + (row_number() over (order by id)), 0, now() from public.products;
insert into public.customers (id, full_name) values ('00000000-0000-0000-0000-0000000000c1', 'Test customer');
insert into public.sales (id, invoice_number, customer_id, customer_name, total_amount, paid_amount, status, created_at)
  select ('00000000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid, 'INV-2026-' || lpad(g::text, 4, '0'),
         '00000000-0000-0000-0000-0000000000c1', 'Test customer', 100 * g, 100 * g, 'posted', now() - make_interval(days => 40 - g)
    from generate_series(1, 40) g;
insert into public.sale_items (id, sale_id, product_id, quantity, unit_price, total_price, product_name)
  select gen_random_uuid(), s.id, p.id, 2, 50, 100, p.name
    from public.sales s join lateral (select id, name from public.products order by random() limit 2) p on true;
SQL
data_section "$PROD" > "$TMP/data-before.txt"

echo
echo "== 1. Preflight on production (read-only)"
"${PSQL[@]}" -At -F ' | ' "$PROD" -f "$ROOT/supabase/scripts/tenant1_preflight.sql" | sed 's/^/  /'

echo
echo "== 2. Backup and the copy everything is tried on first"
pg_dump --format=custom --no-owner --file "$TMP/del-groups.dump" "$PROD"
echo "  dump: $(pg_restore --list "$TMP/del-groups.dump" | grep -c ' TABLE DATA ') tables with data"
pg_restore --no-owner --exit-on-error --dbname "$COPY" "$TMP/del-groups.dump"
diff <(data_section "$COPY") "$TMP/data-before.txt" > /dev/null || fail "the copy differs from production"
echo "  copy restored, same data as production"

echo
echo "== 4. Register tenant #1 in the control plane (twice: re-runnable)"
"${PSQL[@]}" "$CP" -f "$ROOT/scripts/db/supabase-shim.sql"
"${PSQL[@]}" "$CP" -f "$ROOT/control-panel/supabase/tests/vault-shim.sql"
for f in "$ROOT"/control-panel/supabase/migrations/*.sql; do "${PSQL[@]}" "$CP" -f "$f"; done
"${PSQL[@]}" "$CP" <<'SQL'
insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-000000000001', 'del@example.test');
insert into public.platform_admins (user_id, email, role) values ('aaaaaaaa-0000-0000-0000-000000000001', 'del@example.test', 'owner');
SQL
REF="rehearsalcopyref0001"
ANON="eyJrehearsal.anon.key.not-real-0000000000000000"
SERVICE="rehearsal-service-role-key-not-real-000000"
# Unfilled placeholders are refused.
"${PSQL[@]}" "$CP" -f "$ROOT/control-panel/supabase/scripts/register_tenant_1.sql" > /dev/null 2>&1 && fail "placeholders were accepted"
echo "  unfilled placeholders: refused"
sed -e "s/<YOUR PLATFORM ADMIN EMAIL>/del@example.test/" -e "s/<ERP PROJECT REF>/$REF/" \
    -e "s/<ERP ANON OR PUBLISHABLE KEY>/$ANON/" -e "s/<ERP SERVICE ROLE OR SECRET KEY>/$SERVICE/" \
    "$ROOT/control-panel/supabase/scripts/register_tenant_1.sql" > "$TMP/register.sql"
"${PSQL[@]}" "$CP" -f "$TMP/register.sql" > /dev/null
"${PSQL[@]}" -F ' | ' "$CP" -f "$TMP/register.sql" | sed 's/^/  /'
[[ "$(q "$CP" "select count(*) from public.tenants where slug = 'del-groups'")" == 1 ]] || fail "tenant registered twice"
[[ "$(q "$CP" "select count(*) from public.platform_audit_log where action = 'register_tenant_1' and actor_email = 'del@example.test'")" == 2 ]] \
  || fail "registration not audited under the admin"

echo
echo "== What the ERP resolves for erp.del-groups.com after the switch"
(cd "$ROOT" && CONTROL_PLANE_DB_URL="$CP" EXPECT_REF="$REF" EXPECT_ANON="$ANON" EXPECT_SERVICE="$SERVICE" \
  node --import ./scripts/node-ts/register.mjs scripts/tenants/rehearsal-resolve-check.ts 2>&1 \
  | grep -v -e ExperimentalWarning -e MODULE_TYPELESS -e Reparsing -e 'To eliminate' -e trace-warnings) || fail "resolver check"

echo
echo "== 5. Migration history on the copy (twice)"
"${PSQL[@]}" -At "$COPY" -f "$ROOT/supabase/scripts/tenant1_migration_history.sql" | sed 's/^/  recorded: /'
"${PSQL[@]}" -At "$COPY" -f "$ROOT/supabase/scripts/tenant1_migration_history.sql" | sed 's/^/  recorded: /'

echo
echo "== 6. Pending migrations through migrate-all (tenant del-groups only)"
export CONTROL_PLANE_DB_URL="$CP"
export TENANT_DATABASE_URLS="{\"del-groups\":\"$COPY\"}"
set +e
migrate > "$TMP/all.txt"; rc=$?
set -e
[[ $rc == 2 ]] && grep -q "no canary" "$TMP/all.txt" || fail "a run over all tenants must need a canary (rc $rc)"
echo "  run over all tenants without a canary: refused (tenant #1 is never the canary)"
migrate --tenant del-groups --dry-run | sed 's/^/  /'
migrate --tenant del-groups | sed 's/^/  /'
migrate --tenant del-groups | tail -n 3 | sed 's/^/  /'

echo
echo "== 8. Verify"
"${PSQL[@]}" -At -F ' | ' "$COPY" -f "$ROOT/supabase/scripts/tenant1_preflight.sql" | grep -v '^data |' | sed 's/^/  /'
data_section "$COPY" | grep -v 'rows in tenant_modules' > "$TMP/data-after.txt"
grep -v 'rows in tenant_modules' "$TMP/data-before.txt" | diff - "$TMP/data-after.txt" || fail "business data changed"
echo "  business data identical before and after"
[[ "$(q "$COPY" "select display_name || ' / ' || legal_name || ' / ' || voen || ' / ' || iban from public.company_profile")" \
  == "DEL GROUPS MMC / DEL GROUPS MMC / 1234567890 / AZ00TEST0000000000000000" ]] || fail "company profile not filled from today's settings"
echo "  company profile filled from today's settings (screens unchanged)"
[[ "$(q "$COPY" "select count(*) filter (where enabled) || '/' || count(*) from public.tenant_modules")" == "18/18" ]] || fail "modules"
echo "  tenant_modules: 18/18 enabled (same as today: no table = everything on)"
VERSION="$(tr -d '[:space:]' < "$ROOT/supabase/baseline/VERSION")"
NEWER=0; LATEST="$VERSION"
for f in "$ROOT"/supabase/migrations/*.sql; do
  v="$(basename "$f" | cut -c1-14)"
  if [[ "$v" > "$VERSION" ]]; then NEWER=$((NEWER + 1)); LATEST="$v"; fi
done
[[ "$(q "$COPY" "select count(*) from supabase_migrations.schema_migrations where version > '$VERSION'")" == "$NEWER" ]] || fail "history"
echo "  migration history: 117 baseline files + the $NEWER newer ones recorded"
[[ "$(q "$CP" "select schema_version || ' ' || migration_status from public.tenant_databases where supabase_project_ref = '$REF'")" == "$LATEST succeeded" ]] \
  || fail "control plane version"
echo "  control plane: del-groups at $LATEST, last run succeeded"

echo
echo "== 10. Rollback: restore the backup into a fresh database"
pg_restore --no-owner --exit-on-error --dbname "$BASE/r1_restore" "$TMP/del-groups.dump"
diff <(data_section "$BASE/r1_restore") "$TMP/data-before.txt" > /dev/null || fail "restore differs"
echo "  restored database has exactly the data of the backup"

echo
echo "REHEARSAL PASSED"
