#!/usr/bin/env bash
# Rehearsal of scripts/tenants/migrate-all.ts on local Postgres, no Supabase (prompt 10):
# a control plane and three tenant ERP databases (alpha = canary, beta, gamma) plus a
# tenant that is still provisioning. Then:
#   1. dry run: lists pending files, changes nothing;
#   2. a new test migration lands on the canary first, then on the others (batch of 2);
#   3. a deliberately broken migration fails on the canary and the run stops there:
#      beta and gamma are not touched, the canary's failed file is rolled back;
#   4. after the broken file is removed, a re-run finds everything up to date.
#
#   PG_BASE_URL=postgresql://postgres@127.0.0.1:55432 scripts/tenants/e2e-local.sh
#
# PG_BASE_URL is a local superuser connection without a database name. The script drops
# and re-creates only the databases mt_cp, mt_alpha, mt_beta and mt_gamma there.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE="${PG_BASE_URL:-postgresql://postgres@127.0.0.1:55432}"
BASE="${BASE%/}"
if [[ "$BASE" == *supabase.co* || "$BASE" == *supabase.com* ]]; then
  echo "Refusing: PG_BASE_URL must be a local Postgres, not Supabase." >&2
  exit 1
fi
export PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
q() { psql -X -q -At -v ON_ERROR_STOP=1 "$1" -c "$2"; }
fail() { echo "E2E FAILED: $*" >&2; exit 1; }
node_path() { if command -v cygpath > /dev/null; then cygpath -m "$1"; else echo "$1"; fi; }

echo "== Databases"
for db in mt_cp mt_alpha mt_beta mt_gamma; do
  "${PSQL[@]}" "$BASE/postgres" -c "drop database if exists $db with (force)" -c "create database $db"
done

echo "== Tenant ERP databases (baseline + modules + newer migrations)"
for t in alpha beta gamma; do
  DATABASE_URL="$BASE/mt_$t" "$ROOT/scripts/db/build-fresh.sh" --plain-postgres > /dev/null
  echo "  mt_$t: $(q "$BASE/mt_$t" "select count(*) from supabase_migrations.schema_migrations") migrations recorded"
done

echo "== Control plane"
CP="$BASE/mt_cp"
"${PSQL[@]}" "$CP" -f "$ROOT/scripts/db/supabase-shim.sql"
"${PSQL[@]}" "$CP" -f "$ROOT/control-panel/supabase/tests/vault-shim.sql"
for f in "$ROOT"/control-panel/supabase/migrations/*.sql; do "${PSQL[@]}" "$CP" -f "$f"; done
"${PSQL[@]}" "$CP" <<'SQL'
with t as (
  insert into public.tenants (name, slug, status) values
    ('Alpha', 'alpha', 'active'), ('Beta', 'beta', 'trial'), ('Gamma', 'gamma', 'read_only'), ('Delta', 'delta', 'provisioning')
  returning id, slug
)
insert into public.tenant_databases (tenant_id, supabase_project_ref, is_canary, schema_version)
select id, 'local' || slug, slug = 'alpha', (select '20261006100000') from t;
SQL

SQL_DIR="$(mktemp -d)"
trap 'rm -rf "$SQL_DIR"' EXIT
mkdir -p "$SQL_DIR/baseline"
cp "$ROOT/supabase/baseline/VERSION" "$SQL_DIR/baseline/"
cp -r "$ROOT/supabase/migrations" "$SQL_DIR/"

export CONTROL_PLANE_DB_URL="$CP"
export TENANT_DATABASE_URLS="{\"alpha\":\"$BASE/mt_alpha\",\"beta\":\"$BASE/mt_beta\",\"gamma\":\"$BASE/mt_gamma\"}"
migrate() {
  (cd "$ROOT" && node --import ./scripts/node-ts/register.mjs scripts/tenants/migrate-all.ts --local --sql-dir "$(node_path "$SQL_DIR")" "$@")
}

echo
echo "== 1. Dry run with nothing new"
migrate --dry-run
[[ "$(q "$CP" "select count(*) from public.tenant_migration_log")" == 0 ]] || fail "dry run wrote the log"

echo
echo "== 2. New migration: canary first, then beta + gamma"
cat > "$SQL_DIR/migrations/29990101000000_e2e_probe.sql" <<'SQL'
create table if not exists public.e2e_probe (id integer primary key, note text not null);
insert into public.e2e_probe (id, note) values (1, 'hello') on conflict do nothing;
SQL
migrate --dry-run
migrate --batch-size 2 || fail "run 2 failed"
for t in alpha beta gamma; do
  [[ "$(q "$BASE/mt_$t" "select note from public.e2e_probe where id = 1")" == hello ]] || fail "mt_$t has no e2e_probe"
  [[ "$(q "$BASE/mt_$t" "select count(*) from supabase_migrations.schema_migrations where version = '29990101000000' and name = 'e2e_probe'")" == 1 ]] \
    || fail "mt_$t did not record the migration"
  [[ "$(q "$CP" "select d.schema_version || ' ' || d.migration_status from public.tenant_databases d join public.tenants t on t.id = d.tenant_id where t.slug = '$t'")" == "29990101000000 succeeded" ]] \
    || fail "control plane did not record $t's version"
done
order=$(q "$CP" "select string_agg(t.slug, ' ' order by l.id) from public.tenant_migration_log l join public.tenants t on t.id = l.tenant_id where l.migration = '29990101000000_e2e_probe'")
[[ "$order" == "alpha "* ]] || fail "canary was not first: $order"
echo "  applied in this order: $order"

echo
echo "== 3. Broken migration: stops after the canary"
cat > "$SQL_DIR/migrations/29990101000100_e2e_broken.sql" <<'SQL'
alter table public.e2e_probe add column broken integer;
select 1 / 0;
SQL
set +e
migrate --batch-size 2
rc=$?
set -e
[[ $rc == 1 ]] || fail "expected exit code 1, got $rc"
[[ "$(q "$CP" "select migration_status from public.tenant_databases d join public.tenants t on t.id = d.tenant_id where t.slug = 'alpha'")" == failed ]] \
  || fail "canary not marked failed"
[[ "$(q "$BASE/mt_alpha" "select count(*) from information_schema.columns where table_name = 'e2e_probe' and column_name = 'broken'")" == 0 ]] \
  || fail "the canary kept half of the broken migration"
for t in beta gamma; do
  [[ "$(q "$CP" "select count(*) from public.tenant_migration_log l join public.tenants t on t.id = l.tenant_id where t.slug = '$t' and l.migration = '29990101000100_e2e_broken'")" == 0 ]] \
    || fail "$t was touched by the broken migration"
  [[ "$(q "$BASE/mt_$t" "select count(*) from supabase_migrations.schema_migrations where version = '29990101000100'")" == 0 ]] || fail "$t got the broken migration"
  [[ "$(q "$CP" "select schema_version from public.tenant_databases d join public.tenants t on t.id = d.tenant_id where t.slug = '$t'")" == 29990101000000 ]] \
    || fail "$t's version changed"
done
echo "  canary failed; beta and gamma untouched"

echo
echo "== 4. Broken file removed: everyone is up to date"
rm "$SQL_DIR/migrations/29990101000100_e2e_broken.sql"
migrate || fail "run 4 failed"
[[ "$(q "$CP" "select string_agg(migration_status, ',' order by tenant_id) from public.tenant_databases d join public.tenants t on t.id = d.tenant_id where t.slug in ('alpha','beta','gamma')")" == "succeeded,succeeded,succeeded" ]] \
  || fail "not all tenants succeeded"
[[ "$(q "$CP" "select migration_status from public.tenant_databases d join public.tenants t on t.id = d.tenant_id where t.slug = 'delta'")" == idle ]] \
  || fail "the provisioning tenant was touched"

echo
echo "== Migration log"
q "$CP" "select t.slug || '  ' || l.level || '  ' || coalesce(l.migration, '-') || '  ' || l.message from public.tenant_migration_log l join public.tenants t on t.id = l.tenant_id order by l.id"
echo
echo "E2E PASSED"
