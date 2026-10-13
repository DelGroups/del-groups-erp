# Del Groups ERP — Deployment Guide / Yerləşdirmə Təlimatı

Bilingual production deployment guide for **Vercel**, **Docker/VPS**, and **Nginx/cPanel**.

---

## English

### 1. Prerequisites

| Requirement | Notes |
|-------------|-------|
| Node.js 20+ | Local build / non-Docker VPS |
| Supabase project | PostgreSQL + Auth + RLS |
| Domain + SSL | Let's Encrypt or host-provided |

### 2. Environment variables

Copy `.env.example` to `.env.local` (development) or set in your host dashboard (production):

```bash
cp .env.example .env.local
```

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes (runtime) | Supabase project URL; read at runtime, not needed at build |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes (runtime) | Public anon key (RLS protects data); read at runtime, not needed at build |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes (server) | User invites, backup — **never expose to browser** |
| `NEXT_PUBLIC_SITE_URL` | Yes (prod) | Canonical URL, e.g. `https://erp.example.com` |

In **Supabase Dashboard → Authentication → URL Configuration**, add:

- Site URL: `https://erp.example.com`
- Redirect URLs: `https://erp.example.com/auth/callback`, `https://erp.example.com/auth/set-password`

### 3. Database migrations (Supabase SQL Editor)

Run migrations **in order** on a fresh database:

1. `types/schema.sql` — core tables
2. `types/rbac-migration.sql` — roles & permissions
3. `types/security-rls-migration.sql` — row-level security
4. `types/inventory-migration.sql`
5. `types/finance-mutations.sql`
6. `types/locale-migration.sql`
7. `types/warehouse-send-migration.sql`
8. `types/warehouse-delivery-due.sql`
9. `types/warehouse-slips.sql`
10. `types/legacy-sales-migration.sql` (if migrating old data)

Verify in Supabase: **Table Editor** shows `products`, `sales`, `profiles`, `roles`, etc.

Create the first admin user via Supabase Auth, then assign the Admin role in `profiles`.

### 4. Deploy on Vercel (recommended)

1. Push repository to GitHub/GitLab.
2. Import project in [vercel.com](https://vercel.com).
3. Framework preset: **Next.js**.
4. Add all environment variables from `.env.example`.
5. Set `NEXT_PUBLIC_SITE_URL` to your production domain.
6. Deploy — Vercel runs `npm run build` automatically.
7. Attach custom domain: **Project Settings → Domains** (SSL is automatic).

### 5. Deploy with Docker (VPS)

**Current production:** `erp.del-groups.com` runs on the Hetzner VPS next to
Del Social AI. That stack's Caddy (`/opt/del-social-ai/infra/Caddyfile`)
terminates TLS and proxies to this app's container as `erp:3000`
(`docker-compose.prod.yml`, env in `/opt/del-groups-erp/.env.production`).
To ship the committed `HEAD`:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/deploy-hetzner.ps1
```

Manual build. The Supabase URL and keys are read from the **runtime** env
(`src/lib/tenant/config.ts`), so one image works for any Supabase project and
the Supabase build args are optional. If they are passed, they are baked in
and used only as a fallback when the runtime env lacks a value.

```bash
docker build \
  --build-arg NEXT_PUBLIC_SITE_URL=https://erp.example.com \
  -t del-groups-erp .
```

Run (these values are what the app uses):

```bash
docker run -d \
  --name del-groups-erp \
  -p 3000:3000 \
  -e SUPABASE_SERVICE_ROLE_KEY=your_service_role_key \
  -e NEXT_PUBLIC_SUPABASE_URL=https://YOUR_REF.supabase.co \
  -e NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key \
  -e NEXT_PUBLIC_SITE_URL=https://erp.example.com \
  --restart unless-stopped \
  del-groups-erp
```

Health check: `GET /login` should return 200.

#### 5a. Many companies from one deployment (multi-tenant, prompt 8)

Off by default. With `CONTROL_PLANE_URL` / `CONTROL_PLANE_SERVICE_ROLE_KEY` empty, the
app serves one company from `NEXT_PUBLIC_SUPABASE_*`, exactly as above.

When they are set, `src/proxy.ts` looks up every request's `Host` in the control panel
(`control-panel/`, its own Supabase project; lookup `erp_tenant_runtime()`, cached 60 s):

| Tenant | Pages | API |
| --- | --- | --- |
| unknown domain | "address not found" page (404) | `404 {"error":"unknown_tenant"}` |
| `trial`, `active`, `past_due` | normal | normal |
| `read_only` | readable, with a banner; any POST / server action is refused | GET only, otherwise `403 tenant_read_only` |
| `suspended`, `cancelled` | "account suspended" page | `403 tenant_suspended` |
| `provisioning` | "being prepared" page | `503 tenant_provisioning` |
| control plane unreachable | "temporarily unavailable" page | `503 tenant_lookup_failed` |

Each tenant's Supabase URL and anon key reach the app as request headers signed by the
proxy. The service-role key is fetched server-side from the control plane, kept in
memory and never sent to the browser. Register the production domain as a tenant before
turning this on, or it shows "not found".

With Docker, also set `ERP_HEALTHCHECK_HOST` to a registered domain (e.g. `erp.del-groups.com`):
the container healthcheck loads `/login` with that `Host`, because in multi-tenant mode
`127.0.0.1` is not a tenant. Switching Del Groups' own production (tenant #1) step by step,
with backup, rehearsal, smoke test and rollback: `docs/runbooks/tenant-1-cutover.md`.

Note: `read_only` blocks mutations that go through this server (server actions, POST/PUT/
PATCH/DELETE on `/api`). Writes the browser sends straight to Supabase are not blocked by
the proxy; enforcing read-only in the tenant database comes with plan limits (prompt 12).

**Caddy on-demand TLS.** Caddy gets a certificate for a tenant's subdomain or custom domain
the first time it is visited, after asking the ERP whether the domain is registered.
`/api/tenant/domain-check?domain=<host>` answers 200 only for a domain mapped to a tenant
that is not cancelled (in single-tenant mode: only the host of `NEXT_PUBLIC_SITE_URL`),
404 otherwise. Caddyfile:

```caddyfile
{
	on_demand_tls {
		ask http://erp:3000/api/tenant/domain-check
	}
}

# Every tenant domain (subdomains of the product domain and custom domains).
https:// {
	tls {
		on_demand
	}
	reverse_proxy erp:3000
}
```

Keep the existing explicit `erp.del-groups.com { ... }` block as it is; a site block with
a host name takes precedence over the catch-all `https://` block. Caddy calls the `ask`
URL over the internal Docker network, so the endpoint needs no public exposure, and it
answers for any `Host` (the proxy does not resolve a tenant for `/api/tenant/*`).

**Cache invalidation.** The control panel can clear the ERP's tenant cache at once after a
change: set the same random `TENANT_WEBHOOK_SECRET` in both apps and
`ERP_TENANT_WEBHOOK_URL=https://<erp-domain>/api/tenant/invalidate` in the control panel.
The body is signed (HMAC-SHA256, header `x-erp-signature`) and must be under five minutes old.

### 6. Nginx reverse proxy (VPS)

```nginx
server {
    listen 443 ssl http2;
    server_name erp.example.com;

    ssl_certificate     /etc/letsencrypt/live/erp.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/erp.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Obtain SSL with Certbot:

```bash
sudo certbot --nginx -d erp.example.com
```

### 7. cPanel / shared hosting

If Node.js is available via cPanel **Setup Node.js App**:

1. Upload project files (exclude `node_modules`, `.next`).
2. Set startup file: `node server.js` (after `npm run build` with `output: "standalone"`).
3. Map environment variables in cPanel UI.
4. Point domain/subdomain to the Node app port via Apache/Nginx proxy.

If only static hosting is available, use **Vercel** instead — this app requires a Node server.

### 8. Pre-flight checklist

- [ ] `npm run build` succeeds locally
- [ ] All env vars set on host
- [ ] Supabase redirect URLs include production domain
- [ ] RLS policies applied (`security-rls-migration.sql`)
- [ ] Admin user created and active
- [ ] HTTPS enforced (HSTS header in `next.config.ts`)
- [ ] Backups configured in `/settings/backup`

### 9. Security notes

- Service role key: server-only (`SUPABASE_SERVICE_ROLE_KEY`).
- RBAC enforced via `PermissionGuard` + RLS on Supabase.
- API `/api/users/invite` requires `can_manage_users` + rate limiting.
- Security headers (CSP, HSTS, X-Frame-Options) configured in `next.config.ts`.

---

## Azərbaycan dili

### 1. Tələblər

| Tələb | Qeyd |
|-------|------|
| Node.js 20+ | Lokal build / Docker olmayan VPS |
| Supabase layihəsi | PostgreSQL + Auth + RLS |
| Domen + SSL | Let's Encrypt və ya host SSL |

### 2. Mühit dəyişənləri

`.env.example` faylını `.env.local` kimi kopyalayın və doldurun:

```bash
cp .env.example .env.local
```

| Dəyişən | Məcburi | İzah |
|---------|---------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Bəli | Supabase layihə URL-i |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Bəli | Public anon açarı |
| `SUPABASE_SERVICE_ROLE_KEY` | Bəli (server) | Dəvət, backup — brauzerə verməyin |
| `NEXT_PUBLIC_SITE_URL` | Bəli (prod) | Məs: `https://erp.nümunə.az` |

**Supabase → Authentication → URL Configuration**:

- Site URL: production domeniniz
- Redirect URLs: `/auth/callback`, `/auth/set-password`

### 3. Verilənlər bazası miqrasiyaları

Supabase **SQL Editor**-də aşağıdakı faylları **sıra ilə** işlədin:

1. `types/schema.sql`
2. `types/rbac-migration.sql`
3. `types/security-rls-migration.sql`
4. `types/inventory-migration.sql`
5. `types/finance-mutations.sql`
6. `types/locale-migration.sql`
7. `types/warehouse-send-migration.sql`
8. `types/warehouse-delivery-due.sql`
9. `types/warehouse-slips.sql`
10. `types/legacy-sales-migration.sql` (köhnə məlumat varsa)

İlk admin istifadəçini Supabase Auth-da yaradın, `profiles` cədvəlində Admin rolunu təyin edin.

### 4. Vercel-də yerləşdirmə (tövsiyə olunur)

1. Repozitoriyanı GitHub-a push edin.
2. Vercel-də layihəni import edin.
3. `.env.example`-dakı bütün dəyişənləri əlavə edin.
4. `NEXT_PUBLIC_SITE_URL`-i production domeninizə təyin edin.
5. Deploy edin.
6. **Settings → Domains** bölməsində domeni qoşun (SSL avtomatik).

### 5. Docker ilə VPS

Build:

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://SIZIN_REF.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=anon_acari \
  --build-arg NEXT_PUBLIC_SITE_URL=https://erp.nümunə.az \
  -t del-groups-erp .
```

İşə salma:

```bash
docker run -d \
  --name del-groups-erp \
  -p 3000:3000 \
  -e SUPABASE_SERVICE_ROLE_KEY=service_role_acari \
  -e NEXT_PUBLIC_SUPABASE_URL=https://SIZIN_REF.supabase.co \
  -e NEXT_PUBLIC_SUPABASE_ANON_KEY=anon_acari \
  -e NEXT_PUBLIC_SITE_URL=https://erp.nümunə.az \
  --restart unless-stopped \
  del-groups-erp
```

### 6. Domen və SSL (Nginx)

Yuxarıdakı Nginx konfiqurasiyasını istifadə edin. SSL üçün:

```bash
sudo certbot --nginx -d erp.nümunə.az
```

### 7. Yoxlama siyahısı

- [ ] `npm run build` uğurla bitir
- [ ] Bütün env dəyişənləri hostda təyin olunub
- [ ] Supabase redirect URL-ləri production domenini əhatə edir
- [ ] RLS siyasətləri tətbiq olunub
- [ ] Admin istifadəçi aktivdir
- [ ] HTTPS işləyir
- [ ] Backup modulu test edilib

---

## Support / Dəstək

Canonical schema: `types/schema.sql`  
Env reference: `.env.example`  
Security headers: `next.config.ts`
