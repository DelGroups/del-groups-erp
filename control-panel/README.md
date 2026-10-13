# Control panel

The rental control panel of the ERP (plan: `docs/SaaS-Commercialization-Plan.md` §4). It is a
separate Next.js app with its **own Supabase project**. It never connects to the ERP database
or to a tenant database.

This first version manages records only:

- sign-in for platform admins;
- tenants: list, create and edit;
- tenant detail: status, domains, modules, user count, database version and history;
- plans list.

Provisioning (creating tenant databases) comes later.

## Security model

- Only rows in `platform_admins` (with `is_active`) can read or write anything. Every table has
  RLS, and the `anon` role is granted nothing. Signing in with any other account shows "not a
  platform admin" and signs the user out.
- Every insert, update and delete is written to `platform_audit_log` by a database trigger
  (who, when, which row, which fields changed). Sign-in and sign-out are logged through
  `log_platform_action()`. Nobody can change or delete log rows.
- Tenant secrets are stored in Supabase Vault through `set_tenant_secret()`. The
  `tenant_secrets` table only keeps the Vault id. No function returns a secret value.
- The app uses only the project URL and the anon key, together with the signed-in admin's
  session. No service-role key is needed.

## One-time setup (Del)

1. **Create the Supabase project** for the control panel (EU region). It must be a new project,
   not the ERP's.
2. In that project, open **Authentication → Sign In / Providers** and turn off **Allow new users
   to sign up**. Admins are added by hand (step 5).
3. **Apply the migration.** Use either option:
   - **SQL Editor:** paste the contents of
     `control-panel/supabase/migrations/20261012100000_control_plane.sql` and run it.
   - **Supabase CLI**, from `control-panel/`:
     `npx supabase db push --db-url "<the project's Postgres connection string>"`

   The migration is safe to run again. It enables Vault (`supabase_vault`) if it is not on yet,
   and seeds the `modules` table with the ERP's modules.
4. **Fill in `control-panel/.env.local`** (copy `.env.example`). The values come from
   Project Settings → API:

   | Variable | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL, e.g. `https://<ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon / publishable key |
5. **Create the first admin.** In Authentication → Users, use **Add user** with an email and
   password, and tick auto-confirm. Then run this in the SQL Editor, with your email:

   ```sql
   insert into public.platform_admins (user_id, email, full_name, role)
   select id, email, 'Your name', 'owner' from auth.users where email = 'you@example.com';
   ```

   Owners can manage other admins. Further admins are added with the same SQL and the role
   `admin` or `support`.

## Run, test, build

```bash
cd control-panel
npm install
npm run dev      # http://localhost:3100
npm run lint
npm test         # validation, i18n (az/en/ru), migration consistency
npm run build
```

Database checks, without Supabase: on a plain Postgres 17, run `scripts/db/supabase-shim.sql`,
`supabase/tests/vault-shim.sql`, the migrations (twice), then
`supabase/tests/rls_and_audit.sql`, `runtime_lookup.sql` and `tenant_migrations.sql`. Each
prints `ALL CHECKS PASSED`. CI does this in
`.github/workflows/control-panel.yml`.

## Tenant database migrations

New files in `supabase/migrations` (the ERP schema) reach the tenant databases in two ways. Both
use `lib/migrations`, apply only files newer than `supabase/baseline/VERSION` that the tenant
does not have yet (from its `supabase_migrations.schema_migrations`), and record the tenant's
version in `tenant_databases` and every step in `tenant_migration_log`.

- **All tenants:** GitHub Actions → **tenant-migrations** → Run workflow (from `main`, manual
  only; start with the default dry run). The canary tenant goes first and alone, then the others
  in batches. The run stops at the first failure, so a broken migration only reaches the canary.
  Mark the canary on its tenant page. Tenants that are provisioning or cancelled are skipped.
- **One tenant:** "Migrate this tenant" on the tenant page (needs
  `SUPABASE_MANAGEMENT_API_TOKEN`).

The tenants list shows each tenant's DB version and flags the ones behind the repo.
`scripts/tenants/e2e-local.sh` rehearses the whole flow on local Postgres (three tenants, a
working and a broken migration); CI runs it.

## Docker

The image builds from the **repo root**, because the panel reuses `src/design-system`:

```bash
docker build -f control-panel/Dockerfile -t del-groups-control-panel \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=... --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... .
```

With compose it is off by default. Set `CP_SUPABASE_URL` / `CP_SUPABASE_ANON_KEY`, then run
`docker compose --profile control-panel up`. It listens on port 3100. The production deploy
(`admin.<product-domain>`) comes later.

## Layout

| Path | What |
| --- | --- |
| `app/login` | sign-in (only platform admins stay signed in) |
| `app/(admin)` | shell, tenants (list, new, detail and edit) and plans |
| `lib/tenants.ts` | tenant rules, kept in sync with the SQL checks by `tests/schema.test.mjs` |
| `lib/i18n/messages.ts` | all UI text in az, en and ru |
| `lib/auth.ts` | `requireAdmin()`, called by every page and action |
| `proxy.ts` | session refresh and redirect to `/login` |
| `lib/migrations` | tenant migrations: pending files, canary-first run (used by the panel and `scripts/tenants/migrate-all.ts`) |
| `supabase/migrations` | control-plane schema |
| `supabase/tests` | database checks (RLS, audit, Vault) |
