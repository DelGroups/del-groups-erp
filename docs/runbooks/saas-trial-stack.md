# Runbook: the trial / SaaS stack on the Hetzner VPS

The control panel and a second, multi-tenant ERP for trial companies, on the same VPS as
production. **erp.del-groups.com is not touched**: it keeps running from `docker-compose.prod.yml`
(project `del-groups-erp`, single-tenant, `.env.production`) exactly as today.

| Address | Container | Compose |
| --- | --- | --- |
| `erp.del-groups.com` | `erp:3000` (unchanged) | `docker-compose.prod.yml`, project `del-groups-erp` |
| `cp.del-groups.com` | `control-panel:3100` | `docker-compose.saas.yml`, project `del-groups-saas` |
| `<slug>.erp.del-groups.com` | `erp-saas:3000` (multi-tenant) | `docker-compose.saas.yml`, project `del-groups-saas` |

Both new containers join the same external network as production and Caddy,
`del-social-ai_frontend`. Caddy (owned by Del Social AI, `/opt/del-social-ai/infra/Caddyfile`)
reaches them as `control-panel:3100` and `erp-saas:3000`. They also listen on loopback only
(`127.0.0.1:3100`, `127.0.0.1:3003`) for tests through an SSH tunnel.

The whole stack is **off until both env files exist**: `/opt/del-groups-erp/.env.saas` and
`/opt/del-groups-erp/.env.control-panel`. With them, every production deploy
(`/usr/local/bin/del-groups-erp-deploy`) builds and restarts this stack after production is
healthy. A failure there only prints a warning; it never fails or rolls back the production
deploy.

## 0. Before you start

- [ ] The control panel's own Supabase project exists, with its migration applied and the first
      admin created (`control-panel/README.md`, "One-time setup").
- [ ] You have its URL, anon key and service-role key (Project Settings → API).
- [ ] A random shared secret for the cache webhook: `openssl rand -hex 32`.
- [ ] A Supabase personal access token and organization slug, if the panel should create trial
      ERPs (provisioning). Without them the panel works, but "Create the ERP" stays off.

## 1. DNS (at the del-groups.com DNS provider)

| Type | Name | Value |
| --- | --- | --- |
| A | `cp` | the VPS IPv4 (the same as `erp`) |
| A | `*.erp` | the VPS IPv4 |
| AAAA (only if `erp` has one) | `cp`, `*.erp` | the VPS IPv6 |

Do not change the existing `erp`, `app`, `ai`, `api` or `panel` records. `panel.del-groups.com`
is a CNAME to Vercel. Check: `dig +short cp.del-groups.com` and
`dig +short demo.erp.del-groups.com` both return the VPS address.

## 2. Env files on the server

Copy the templates from the deployed source (`/opt/del-groups-erp` after this PR is deployed) and
fill them in. Never put the production project's keys in `.env.saas`.

```bash
cd /opt/del-groups-erp
install -m 600 .env.saas.example .env.saas
install -m 600 control-panel/.env.example .env.control-panel
nano .env.saas            # CONTROL_PLANE_URL, CONTROL_PLANE_SERVICE_ROLE_KEY, TENANT_WEBHOOK_SECRET
nano .env.control-panel   # see the table below
```

`.env.control-panel` on the server:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the control panel's project (also the image's build args) |
| `CONTROL_PLANE_SERVICE_ROLE_KEY` | the control panel's service-role key |
| `TENANT_BASE_DOMAIN` | `erp.del-groups.com` |
| `ERP_TENANT_WEBHOOK_URL` | `http://erp-saas:3000/api/tenant/invalidate` (over the docker network) |
| `TENANT_WEBHOOK_SECRET` | the same value as in `.env.saas` |
| `SUPABASE_MANAGEMENT_API_TOKEN`, `SUPABASE_ORG_SLUG` | optional, for provisioning |
| `TENANT_SMTP_HOST`, `TENANT_SMTP_PORT`, `TENANT_SMTP_USER`, `TENANT_SMTP_PASS`, `TENANT_SMTP_SENDER_EMAIL` (`TENANT_SMTP_SENDER_NAME` optional) | tenants' sign-in emails: `smtp.resend.com`, `465`, `resend`, a Resend API key, e.g. `no-reply@del-groups.com` (SAAS-2; all or none) |
| `ERP_SQL_DIR`, `BILLING_FONT_DIR` | leave empty (the image sets them) |

Check that no production key slipped into the trial ERP. This prints nothing when everything is
right:

```bash
grep -E '^(SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY)=.' .env.saas
```

## 3. Caddy

Edit `/opt/del-social-ai/infra/Caddyfile`. First make a copy:

```bash
cp -p /opt/del-social-ai/infra/Caddyfile /opt/del-social-ai/infra/Caddyfile.bak-$(date +%F)
grep -n 'on_demand_tls\|^{' /opt/del-social-ai/infra/Caddyfile   # is there a global options block?
```

**Global options.** There is only ever one global options block, the `{ ... }` at the very top
of the file. If it exists, add the `on_demand_tls` lines **inside** it. If it already has an
`on_demand_tls`, change only its `ask` line (and keep anything else it has). If there is no global
block, add this one as the first lines of the file:

```caddyfile
{
	on_demand_tls {
		ask http://erp-saas:3000/api/tenant/domain-check
	}
}
```

**Site blocks.** Leave every existing site block exactly as it is: `erp.del-groups.com` first and
unchanged, and also `app.del-groups.com`, `ai.del-groups.com` and `api.del-groups.com` (Del
Social AI). Add these two blocks at the **end** of the file:

```caddyfile
# Control panel (SAAS-1).
cp.del-groups.com {
	encode zstd gzip
	reverse_proxy control-panel:3100
}

# Trial companies (SAAS-1): <slug>.erp.del-groups.com and custom domains. A certificate is issued
# on the first visit, only after erp-saas confirms the domain is a registered tenant
# (on_demand_tls ask above). Every named site block above takes precedence over this catch-all.
https:// {
	tls {
		on_demand
	}
	encode zstd gzip
	reverse_proxy erp-saas:3000
}
```

**Validate, then reload** (a reload keeps the old config when the new one is invalid):

```bash
CADDY=$(docker ps --format '{{.Names}}' | grep -i caddy | head -1); echo "$CADDY"
docker exec "$CADDY" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec "$CADDY" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

If the Caddyfile is mounted at another path inside the container, use that path
(`docker inspect "$CADDY" --format '{{json .Mounts}}'`).

Check right after the reload that the existing sites still answer:

```bash
for h in erp.del-groups.com app.del-groups.com ai.del-groups.com api.del-groups.com; do
  printf '%s ' "$h"; curl -s -o /dev/null -w '%{http_code}\n' "https://$h/"
done
```

## 4. Start (the first time)

Either let the next production deploy start it (it does so once both env files exist), or start
it by hand from the deployed source:

```bash
cd /opt/del-groups-erp
docker compose -p del-groups-saas --env-file .env.saas --env-file .env.control-panel \
  -f docker-compose.saas.yml up -d --build
docker ps --filter name=del-groups-saas --format '{{.Names}}\t{{.Status}}'   # both "(healthy)"
```

Healthcheck: the trial ERP checks `/api/tenant/health`, which answers for any host without a
tenant lookup, so it is healthy before the first trial company exists. The control panel checks
`/login`.

## 5. Smoke test

```bash
curl -s http://127.0.0.1:3003/api/tenant/health                          # {"ok":true}
curl -s -o /dev/null -w '%{http_code}\n' https://cp.del-groups.com/login  # 200
# An unregistered subdomain gets no certificate (the ask answers 404):
curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:3003/api/tenant/domain-check?domain=nobody.erp.del-groups.com"  # 404
```

Then, in the control panel: create a tenant (e.g. slug `demo`), provision it, and open
`https://demo.erp.del-groups.com` (the first visit takes a few seconds while Caddy gets the
certificate). Finally, check that `https://erp.del-groups.com` is unchanged.

## 6. Stop, restart, logs

```bash
cd /opt/del-groups-erp
SAAS=(docker compose -p del-groups-saas --env-file .env.saas --env-file .env.control-panel -f docker-compose.saas.yml)
"${SAAS[@]}" ps
"${SAAS[@]}" logs --tail 100 erp-saas
"${SAAS[@]}" restart control-panel
"${SAAS[@]}" stop            # stop both, keep the containers
"${SAAS[@]}" up -d           # start again
```

## 7. Rollback (back to exactly today)

1. **Stop the stack:**
   ```bash
   cd /opt/del-groups-erp
   docker compose -p del-groups-saas --env-file .env.saas --env-file .env.control-panel -f docker-compose.saas.yml down
   ```
2. **Turn it off for future deploys:** rename one env file, e.g.
   `mv .env.saas .env.saas.off`. A deploy then prints `trial stack: off` and does nothing.
3. **Caddy:** remove the `cp.del-groups.com` and `https://` blocks and the `on_demand_tls` lines
   you added (or restore `Caddyfile.bak-<date>`), then validate and reload as in step 3.
4. **DNS (optional):** remove the `cp` and `*.erp` records.

Production is never part of the rollback: `del-groups-erp` and `.env.production` stay as they are.

## 8. The deploy script

`scripts/server/erp-deploy.sh` is installed on the server by hand. After this PR is merged and
deployed, reinstall it from the deployed source:

```bash
install -m 755 -o root -g root /opt/del-groups-erp/scripts/server/erp-deploy.sh /usr/local/bin/del-groups-erp-deploy
```

What it does now, under the same lock as before:
1. Builds and checks production from a staging copy, switches the source, restarts production
   and waits for healthy. This part is unchanged.
2. Keeps `.env.saas` and `.env.control-panel` when it switches the source (before, every file
   except `.env.production` was replaced).
3. Only if both env files exist: builds the trial stack from the staging copy, restarts it and
   waits for both containers. On any failure it prints
   `!! WARNING: trial stack (del-groups-saas) not updated - production deploy is fine` and the
   deploy still succeeds.
4. Runs `docker builder prune -af --filter until=72h`, to drop build cache older than three days
   (the disk filled with it on 2026-10-17).
