# Database baseline

This folder lets anyone build a complete, empty Del Groups ERP database from the
repo with one command, without the 35 legacy `types/*.sql` files and without
replaying the 117 historical migrations.

```bash
scripts/db/build-fresh.sh                        # into `supabase start` (127.0.0.1:54322)
DATABASE_URL=postgres://... scripts/db/build-fresh.sh
scripts/db/build-fresh.sh --plain-postgres       # any plain Postgres 17, no Docker
```

`--plain-postgres` first loads `scripts/db/supabase-shim.sql`, a small stand-in for
the Supabase parts the schema points at (`auth.users`, `auth.uid()`, `storage.buckets`,
`storage.objects`, the `anon` / `authenticated` / `service_role` roles). Leave it off
on a real Supabase database. The script refuses hosted `*.supabase.co` URLs (set
`ALLOW_REMOTE=1` only for a brand-new, empty project) and any database that already
has sales or products.

## Where it comes from

The baseline is the production schema, not the migration files: some changes were
applied to production by hand, so the files alone do not rebuild it.

1. `catalog.sql` is a read-only query that returns the whole `public` schema (tables,
   columns, defaults, constraints, indexes, views, functions, triggers, RLS policies,
   grants) plus storage buckets, storage policies and the realtime publication, as one
   JSON document. Its output for production is committed as `live-catalog.json`.
2. `python3 scripts/db/generate-baseline.py` turns that JSON into the numbered files
   below. They are generated: never edit them by hand, CI fails if they drift from
   `live-catalog.json`.
3. `seed-data.json` holds the only rows a new ERP needs to boot: the Admin / Manager /
   User roles, the chart of accounts the posting functions look up, default income
   and expense categories, and the module defaults in `system_settings` (taken from the
   original migrations, company-neutral, with an empty n8n secret). No customers,
   products, documents, company profile, bank accounts or other business data.

| File | Contents |
| --- | --- |
| `00_extensions.sql` | `extensions` schema, `pgcrypto`, `uuid-ossp` |
| `01_types.sql` | enums |
| `02_sequences.sql` | standalone sequences |
| `03_tables.sql` | tables with column types and NOT NULL |
| `04_functions.sql` | all `public` functions (`check_function_bodies = off`) |
| `05_defaults.sql` | column defaults, sequence ownership |
| `06_constraints.sql` | primary keys, unique, check, then foreign keys |
| `07_indexes.sql` | other indexes |
| `08_views.sql` | views in dependency order |
| `09_triggers.sql` | triggers, including `on_auth_user_created` on `auth.users` |
| `10_rls_policies.sql` | RLS on/off per table and every policy (public + storage) |
| `11_grants.sql` | exact table, view, sequence and function privileges |
| `12_storage_realtime.sql` | storage buckets, `supabase_realtime` publication tables |
| `13_seed.sql` | rows from `seed-data.json` |

Every file can be re-run on a database built from it (`if not exists`,
`create or replace`, `drop policy if exists`, guarded `add constraint`).

## How migrations relate to the baseline

`VERSION` holds the newest migration the baseline already contains
(`20261006100000`). From now on:

- New schema changes are still one file in `supabase/migrations/` with a unique,
  newer timestamp. Do not edit the baseline to make a change.
- `build-fresh.sh` applies the baseline, then only the migration files newer than
  `VERSION`, and records every file in `supabase_migrations.schema_migrations` so
  `supabase db push` on a database built this way sends only later files.
- Files at or below `VERSION` stay in the repo as history; a fresh build skips them.
- Once a batch of new migrations is live in production, refresh the baseline:
  run `catalog.sql` against production (read-only, for example
  `psql "$DB_URL" -X -q -At -f supabase/baseline/catalog.sql > supabase/baseline/live-catalog.json`
  with the URL from `.env.local`, or through the Supabase connector), set `VERSION` to
  the newest migration it includes, run `generate-baseline.py`, and commit all three.

## The check in CI

`.github/workflows/db-baseline.yml` runs on every PR that touches `supabase/` or
`scripts/db/`. It installs Postgres 17 on the GitHub runner (no Docker), checks the
generated files are current, builds the baseline, runs `catalog.sql` against it and
compares the result with `live-catalog.json` using `scripts/db/compare-catalog.py`.
Any missing, extra or different object fails the job and is listed in the job
summary. It then re-runs the baseline (re-run safety) and applies the newer
migrations on top. It never connects to production.

The comparer treats one spelling difference as equal: Postgres prints
`col::text = ANY (ARRAY['a'::varchar, ...])` check constraints differently after they
are dumped and re-created, with the same meaning.

To check production for drift since the snapshot, run `catalog.sql` against it again
and compare: `python3 scripts/db/compare-catalog.py supabase/baseline/live-catalog.json new.json`.
