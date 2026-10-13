# Runbook: Del Groups becomes tenant #1

Registers the existing production ERP database (Supabase project of `erp.del-groups.com`) as
tenant #1 in the control panel and switches the ERP container to multi-tenant mode. **No data
moves**: the same database keeps serving `erp.del-groups.com`; only where the ERP reads its
Supabase URL and keys from changes (control plane instead of `.env.production`).

Plan: `docs/SaaS-Commercialization-Plan.md` §7. Built in prompt 11. Everything here is done by
Del; nothing in the repo touches production.

| | |
| --- | --- |
| Time | about 1 hour, plus the rehearsal (step 3) on an earlier day |
| Staff impact | about 10 s while the container restarts (step 7); pick a quiet moment |
| Reversible | step 7 in one minute (rollback A); steps 4–6 add records/tables only |

## Overview

| Step | What | Where | Changes production? |
| --- | --- | --- | --- |
| 0 | Prerequisites | — | no |
| 1 | Preflight + smoke test baseline | ERP SQL Editor, your PC | no (read-only) |
| 2 | Backup | VPS (Docker) | no |
| 3 | Rehearse steps 4–8 on a copy | new Supabase project, VPS | no |
| 4 | Register tenant #1 | control panel SQL Editor | no (control panel only) |
| 5 | Record the migration history | ERP SQL Editor | adds rows to `supabase_migrations` only |
| 6 | Apply the pending migrations | GitHub Actions | yes: 4 additive migrations |
| 7 | Switch the ERP container to multi-tenant mode | VPS | yes: where the config comes from |
| 8 | Verify | your PC, browser, ERP SQL Editor | no |
| 9 | Watch | VPS | no |
| 10 | Rollback, if needed | VPS / SQL Editor | — |

Files used:

| File | Runs on |
| --- | --- |
| `supabase/scripts/tenant1_preflight.sql` | ERP database, read-only |
| `supabase/scripts/tenant1_migration_history.sql` | ERP database |
| `control-panel/supabase/scripts/register_tenant_1.sql` | control panel database |
| `scripts/tenants/smoke-test.ts` (`npm run tenants:smoke`) | your PC, against the site |
| `scripts/tenants/rehearse-tenant-1.sh` | local Postgres only (CI runs it on every change) |

---

## 0. Prerequisites

- [ ] The control panel's Supabase project has all four control-plane migrations
      (`control-panel/supabase/migrations/2026101210*`, `…120000`, `…140000`, `…20261013100000`),
      and you are in `platform_admins` (role owner).
- [ ] **The control panel project must never pause.** After step 7 `erp.del-groups.com`
      needs it for every request (cached 60 s); if it is paused or down, staff see
      "temporarily unavailable". Use a paid plan for it (free projects pause when idle).
- [ ] The `tenant-migrations` workflow secrets exist (prompt 10): `CONTROL_PLANE_URL`,
      `CONTROL_PLANE_SERVICE_ROLE_KEY`, `SUPABASE_MANAGEMENT_API_TOKEN`. The token's account
      must have access to the **ERP's** Supabase organization.
- [ ] Main is deployed with this PR (the container healthcheck reads `ERP_HEALTHCHECK_HOST`).
- [ ] On your PC: the repo on `main`, `npm install` done, and an ERP user for the smoke test
      who can see sales and stock (your admin account works). Set them in the terminal only:

      ```powershell
      $env:SMOKE_EMAIL = "you@del-groups.com"
      $env:SMOKE_PASSWORD = Read-Host -MaskInput "ERP password"
      ```
- [ ] SSH access to the VPS as root.
- [ ] No DNS change is needed: `erp.del-groups.com` keeps pointing at the VPS and Caddy keeps
      its explicit `erp.del-groups.com { … }` block.

## 1. Preflight and smoke-test baseline (read-only)

1. ERP Supabase project → SQL Editor → paste `supabase/scripts/tenant1_preflight.sql` → Run.
   Export the result (CSV) as `preflight-before.csv`. How to read it:
   - `history / schema_migrations table`: `missing` is expected (production was built by hand).
     Step 5 creates it.
   - `pending / …`: which of the newer migrations already took effect. Usually
     `company_profile` and `tenant_modules` are `missing`, `is_admin()` says `no`, and the
     RLS line says `0` (20261011150000 was applied by hand on 2026-10-11). Any mix is fine:
     all of them are safe to run again.
   - `data / …`: row counts, stock total and newest sale. They must not drop later.
2. On your PC, in the repo:

   ```powershell
   npm run tenants:smoke -- --save tenant1-before.json
   ```

   Every line must be `PASS`, with `public config … (single-tenant mode)`. Keep the file
   (it holds counts and the Supabase host, no secrets).

## 2. Backup

Supabase keeps daily backups (Dashboard → Database → Backups); check the newest one is from
today or yesterday. In addition, take your own dump on the VPS (Docker runs `pg_dump` 17, no
install needed):

```bash
ssh root@<vps>
mkdir -p /root/backups && chmod 700 /root/backups
# ERP project → Connect → Session pooler → URI (with the database password). Paste, Enter.
read -rs DB_URL && export DB_URL
docker run --rm -e DB_URL -v /root/backups:/backup postgres:17-alpine sh -c '
  d=$(date +%F)
  pg_dump "$DB_URL" --format=custom --no-owner --schema=public --file=/backup/del-groups-public-$d.dump &&
  pg_dump "$DB_URL" --format=custom --data-only --schema=auth --file=/backup/del-groups-auth-$d.dump &&
  pg_dump "$DB_URL" --format=custom --data-only --table=storage.buckets --table=storage.objects \
          --file=/backup/del-groups-storage-meta-$d.dump'
unset DB_URL
docker run --rm -v /root/backups:/backup postgres:17-alpine \
  sh -c 'for f in /backup/del-groups-*-$(date +%F).dump; do echo "$f: $(pg_restore --list "$f" | grep -c "TABLE DATA") tables"; done'
```

The public dump should list about 85–90 tables. Files in Storage are not touched by this
cutover, so they are not copied. Keep the dumps until a week after the cutover.

## 3. Rehearse on a copy (an earlier day)

Do steps 4–8 once on a copy of the database, with a second ERP container that only you can
reach. Production keeps running untouched.

1. **Make the copy.** Preferred: ERP project → Database → Backups → *Restore to a new project*
   (if your plan offers it). It copies the data, users and settings. Otherwise create a new
   project (EU) and follow Supabase docs "Migrating within Supabase → Backup and restore using
   the CLI" (roles, schema, data with `session_replication_role = replica`). Name it
   `erp-del-groups-rehearsal`.
2. **Register it** with `register_tenant_1.sql` (step 4), using the **copy's** ref and keys and,
   in the values block, slug `del-groups-rehearsal`, name `Del Groups (rehearsal)`, domain
   `localhost`.
3. Run step 5 on the **copy's** SQL Editor, and step 6 with tenant `del-groups-rehearsal`.
4. **Start a rehearsal container** from the image that already runs production:

   ```bash
   cd /opt/del-groups-erp
   install -m 600 .env.production /root/backups/.env.rehearsal
   nano /root/backups/.env.rehearsal
   #   delete the line SUPABASE_SERVICE_ROLE_KEY=...   (the rehearsal must never hold
   #   production's key; multi-tenant mode does not read it)
   #   add:
   #   CONTROL_PLANE_URL=https://<control-panel-ref>.supabase.co
   #   CONTROL_PLANE_SERVICE_ROLE_KEY=<control panel service-role key>
   #   ERP_HEALTHCHECK_HOST=localhost
   docker run -d --name erp-rehearsal --env-file /root/backups/.env.rehearsal \
     -p 127.0.0.1:3002:3000 del-groups-erp:latest
   sleep 40; docker inspect -f '{{.State.Health.Status}}' erp-rehearsal   # healthy
   ```
5. From your PC, open a tunnel and smoke-test the copy (and click around in the browser at
   `http://localhost:3002`; do not invite users from it, invite links point to the real domain):

   ```powershell
   ssh -N -L 3002:127.0.0.1:3002 root@<vps>          # leave open in a second terminal
   npm run tenants:smoke -- --url http://localhost:3002 --compare tenant1-before.json
   ```

   Expect `PASS` everywhere, `(multi-tenant mode)`, and in the comparison a different
   Supabase host (it is the copy): that single `FAIL` is expected here.
6. **Clean up:** `docker rm -f erp-rehearsal && shred -u /root/backups/.env.rehearsal`; in the
   control panel set tenant `del-groups-rehearsal` to `cancelled`; delete the copy project.

`scripts/tenants/rehearse-tenant-1.sh` rehearses the database steps (1, 2, 4, 5, 6, 8 and the
restore of rollback C) on local Postgres; CI runs it for every change to these files.

## 4. Register tenant #1 (control panel)

1. Control panel project → SQL Editor → paste `control-panel/supabase/scripts/register_tenant_1.sql`.
2. Fill in the four `<...>` values: your admin email, the ERP project ref, and the ERP's
   **current** anon key and service-role key (ERP project → Project Settings → API; the same
   values as `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in the server's
   `.env.production`). Leave slug, name and domain as they are.
3. Run. The last result shows `del-groups | active | erp.del-groups.com | t | <ref> | f | 2`.
4. Clear the keys from the editor and do not save the snippet.

Until step 7 nothing uses this record. Do **not** mark `del-groups` as canary.

## 5. Record the migration history (ERP database)

ERP project → SQL Editor → paste `supabase/scripts/tenant1_migration_history.sql` → Run. It
creates `supabase_migrations.schema_migrations` if missing and records the 117 migrations the
baseline already contains (`recorded_up_to_20261006100000 = 117` or more). It touches no ERP
table and is safe to run twice.

## 6. Apply the pending migrations

GitHub → Actions → **tenant-migrations** → Run workflow (branch `main`):

1. `dry_run` ticked, `tenant` = `del-groups`. The summary lists the files it would apply
   (normally the four `20261011…` files and `20261014100000_tenant_limits`). Nothing else may be listed.
2. Run again with `dry_run` unticked, `tenant` = `del-groups`. Result `migrated`, version
   = the newest file listed in step 1 (`20261014100000` at the time of writing).

What staff notice (all intended by earlier prompts):

| Migration | Effect |
| --- | --- |
| `20261011120000_company_profile` | Settings → Company exists, filled with exactly today's name, VÖEN, bank, logo, seal; invoices look the same |
| `20261011130000_tenant_modules` | every module stays on (same as today without the table) |
| `20261011140000_fix_is_admin_role_column` | fixes the `column "role" does not exist` error when saving CRM deals and HR advances/leaves/payrolls |
| `20261011150000_enable_rls_on_remaining_tables` | already in production; runs again with the same result |
| `20261014100000_tenant_limits` | adds the empty plan-limits table, the seat trigger and the storage quota policy; with no limits row (no subscription) nothing changes |

Then, still in single-tenant mode:

```powershell
npm run tenants:smoke -- --compare tenant1-before.json
```

All `PASS` (now `modules … 18 of 18 enabled`).

## 7. Switch the ERP container to multi-tenant mode

```bash
ssh root@<vps>
cd /opt/del-groups-erp
cp -p .env.production /root/backups/env.production.before-tenant1     # for rollback A
nano .env.production
#   add these lines (keep every existing line):
#   CONTROL_PLANE_URL=https://<control-panel-ref>.supabase.co
#   CONTROL_PLANE_SERVICE_ROLE_KEY=<control panel service-role key>
#   ERP_HEALTHCHECK_HOST=erp.del-groups.com
#   Optional, instant cache refresh after control-panel changes (same value in the control
#   panel's TENANT_WEBHOOK_SECRET, and ERP_TENANT_WEBHOOK_URL=https://erp.del-groups.com/api/tenant/invalidate there):
#   TENANT_WEBHOOK_SECRET=<random, e.g. openssl rand -hex 32>
docker compose -p del-groups-erp --env-file .env.production -f docker-compose.prod.yml up -d --force-recreate --no-build
for i in $(seq 1 30); do s=$(docker inspect -f '{{.State.Health.Status}}' del-groups-erp-erp-1); echo "$s"; [ "$s" = healthy ] && break; sleep 3; done
docker logs --tail 30 del-groups-erp-erp-1
curl -s https://erp.del-groups.com/api/public-config | grep -o '"controlPlane":true'
```

- Health must reach `healthy` (it now loads `/login` as `erp.del-groups.com` through the
  control plane). If it shows `unhealthy`, or the `curl` prints nothing, do rollback A.
- No rebuild: the switch is runtime env only. Later deploys keep it (`erp-deploy.sh` keeps
  `.env.production`).

## 8. Verify

1. Smoke test from your PC:

   ```powershell
   npm run tenants:smoke -- --compare tenant1-before.json
   ```

   All `PASS`; `public config … (multi-tenant mode)`; comparison: same Supabase project,
   `mode single-tenant -> control-plane`, sales and stock rows not fewer.
2. In the browser (normal window, then an incognito window):
   - [ ] log in as a staff user; the dashboard loads
   - [ ] Sales: list loads; open a recent sale; print preview of the invoice shows the usual
         header, logo and seal
   - [ ] Stock levels (Inventory) show the usual quantities
   - [ ] the next real piece of work a colleague does anyway (e.g. recording a sale) saves
         normally; do not create test records in production
   - [ ] log out and log in again
3. ERP SQL Editor: run `tenant1_preflight.sql` again → `preflight-after.csv`. Every `data`
   count is equal or higher than in `preflight-before.csv`; `history` shows 121+ rows.
4. Control panel → Tenants: `del-groups` shows the newest DB version (`20261014100000` at the time of writing) without "behind";
   its page shows the migration log of step 6.

## 9. Watch (first day)

```bash
docker logs --since 1h del-groups-erp-erp-1 2>&1 | grep -E '\[tenant\]|\[modules\]' | tail
```

`[tenant] control plane lookup failed` means the control panel project was unreachable;
staff saw "temporarily unavailable" meanwhile. If it repeats, do rollback A and check the
control panel project.

## 10. Rollback

**A. Back to single-tenant mode (any time, one minute, no data change):**

```bash
cd /opt/del-groups-erp
cp -p /root/backups/env.production.before-tenant1 .env.production
docker compose -p del-groups-erp --env-file .env.production -f docker-compose.prod.yml up -d --force-recreate --no-build
docker inspect -f '{{.State.Health.Status}}' del-groups-erp-erp-1     # healthy after ~30 s
```

The tenant record in the control panel can stay; nothing reads it in single-tenant mode.

**B. Undo one of the step-6 migrations** (only if it causes a problem; all are additive). ERP
SQL Editor, one block per migration, then remove its history row so it can be applied again
later:

```sql
-- 20261011130000_tenant_modules: without the table the app turns every module on (as before)
drop table if exists public.tenant_modules;
delete from supabase_migrations.schema_migrations where name in ('20261011130000_tenant_modules', 'tenant_modules');

-- 20261011120000_company_profile: the app falls back to settings / company_settings (as before)
drop table if exists public.company_profile;
drop function if exists public.company_profile_guard();
alter table public.settings alter column company_name set default 'DEL GROUPS MMC';
alter table public.company_settings alter column company_name set default 'Del Groups MMC';
delete from supabase_migrations.schema_migrations where name in ('20261011120000_company_profile', 'company_profile');
```

Do not undo `20261011140000` (it fixes a broken check) or `20261011150000` (it was already in
production before this cutover).

**C. Restore data** (last resort, loses every change made after the backup): use Supabase's
own restore (Dashboard → Database → Backups / point in time). The step-2 dumps are the
second copy; restoring them over the live project needs `pg_restore --clean` on the public
schema and is a decision for Del, not part of this runbook.

## Rehearsal record

`scripts/tenants/rehearse-tenant-1.sh` output (local Postgres 17.6, stand-in database built from
the production snapshot with synthetic data, worst-case history) is in the prompt-11 PR.
