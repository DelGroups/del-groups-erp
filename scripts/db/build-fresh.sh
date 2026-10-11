#!/usr/bin/env bash
# Build a complete, empty Del Groups ERP database from the repo:
# supabase/baseline/*.sql (the schema as it was in production at baseline VERSION),
# then every supabase/migrations file newer than that version.
#
#   scripts/db/build-fresh.sh                      # local Supabase (`supabase start`)
#   DATABASE_URL=postgres://... scripts/db/build-fresh.sh
#   scripts/db/build-fresh.sh --plain-postgres     # any Postgres 17, no Supabase/Docker
#   scripts/db/build-fresh.sh --baseline-only      # stop after the baseline (used by CI)
#
# --plain-postgres first loads scripts/db/supabase-shim.sql (auth.users, auth.uid(),
# storage.buckets/objects, API roles). Leave it off on a real Supabase database.
# The script refuses to touch a database that already holds ERP business data.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE_DIR="$ROOT/supabase/baseline"
MIGRATIONS_DIR="$ROOT/supabase/migrations"
DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
PLAIN=0
BASELINE_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --plain-postgres) PLAIN=1 ;;
    --baseline-only) BASELINE_ONLY=1 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [[ "$DATABASE_URL" == *supabase.co* || "$DATABASE_URL" == *supabase.com* ]] && [[ "${ALLOW_REMOTE:-}" != "1" ]]; then
  echo "Refusing: DATABASE_URL points at a hosted Supabase project." >&2
  echo "This script is for local or brand-new databases. Set ALLOW_REMOTE=1 only for a new, empty project." >&2
  exit 1
fi

export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
PSQL=(psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -c "select 1" > /dev/null

has_data=0
if [[ "$("${PSQL[@]}" -At -c "select to_regclass('public.sales') is not null and to_regclass('public.products') is not null")" == "t" ]]; then
  has_data=$("${PSQL[@]}" -At -c "select (exists (select 1 from public.sales) or exists (select 1 from public.products))::int")
fi
if [[ "$has_data" != "0" ]]; then
  echo "Refusing: this database already has sales or products. build-fresh only builds empty databases." >&2
  exit 1
fi

VERSION="$(tr -d '[:space:]' < "$BASELINE_DIR/VERSION")"
echo "Baseline version $VERSION"

if [[ $PLAIN == 1 ]]; then
  echo "Loading Supabase shim for plain Postgres"
  "${PSQL[@]}" -f "$ROOT/scripts/db/supabase-shim.sql"
fi

echo "Applying baseline"
{
  for f in "$BASELINE_DIR"/[0-9][0-9]_*.sql; do
    echo "\\echo '  $(basename "$f")'"
    echo "\\ir $f"
  done
} | "${PSQL[@]}" --single-transaction -f -

"${PSQL[@]}" <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
SQL

if [[ $BASELINE_ONLY == 1 ]]; then
  echo "Done: baseline $VERSION only."
  exit 0
fi

applied=0
values=()
for f in "$MIGRATIONS_DIR"/*.sql; do
  base="$(basename "$f" .sql)"
  if [[ ! "$base" =~ ^([0-9]{14})_([a-z0-9_]+)$ ]]; then
    echo "Skipping $base.sql: name is not <14-digit version>_<name>.sql" >&2
    continue
  fi
  version="${BASH_REMATCH[1]}"
  name="${BASH_REMATCH[2]}"
  if [[ "$version" > "$VERSION" ]]; then
    echo "Applying migration $base"
    "${PSQL[@]}" --single-transaction -f "$f"
    applied=$((applied + 1))
  fi
  values+=("('$version', '$name')")
done

# Mark every migration file as applied, so `supabase db push` on a project built
# this way only sends the files added after this run.
if (( ${#values[@]} )); then
  "${PSQL[@]}" -c "insert into supabase_migrations.schema_migrations (version, name) values $(IFS=,; echo "${values[*]}") on conflict (version) do nothing"
fi

echo "Done: baseline $VERSION + $applied newer migration(s)."
