# Security Audit Report — Del Groups ERP

**Date:** 2026-08-24  
**Scope:** Authentication/RBAC, Supabase RLS, API validation, code quality  
**Stack:** Next.js (App Router), TypeScript, Supabase (PostgreSQL)

---

## Executive Summary

The application relied primarily on **client-side UI guards** while business mutations used the **browser Supabase client with the anon key**. Without database-level Row Level Security (RLS) on ERP tables, any authenticated user could bypass the UI and call Supabase REST directly to read or mutate data outside their role.

This audit **fixed application-layer gaps** (inactive users, invite API hardening, profile privilege escalation) and **delivered a production RLS migration** that must be applied in Supabase to enforce authorization at the database layer.

---

## A) Vulnerabilities Found

### Critical

| ID | Issue | Impact |
|----|-------|--------|
| **C-1** | No RLS on business tables (`sales`, `products`, `transactions`, `employees`, etc.) | Any signed-in user with the anon key could SELECT/INSERT/UPDATE/DELETE across the ERP schema via direct API calls. |
| **C-2** | `profiles_update` RLS allowed self-update of **any column** including `role_id` and `is_active` | Regular users could escalate to Admin by PATCHing their own profile. |
| **C-3** | RBAC enforced only in React (`PermissionGuard`, sidebar filtering) | UI bypass via DevTools, curl, or Supabase client = full data access (until RLS is applied). |

### High

| ID | Issue | Impact |
|----|-------|--------|
| **H-1** | Deactivated users (`is_active = false`) retained valid JWT sessions | Disabled accounts could still access the app until token expiry. |
| **H-2** | Invite API lacked Admin-role assignment guard | User managers could invite users with the Admin role. |
| **H-3** | Invite API missing UUID validation and field length limits | Malformed payloads; potential for unexpected DB behavior. |

### Medium

| ID | Issue | Impact |
|----|-------|--------|
| **M-1** | Middleware (`src/proxy.ts`) session-only — no permission checks | By design (avoids redirect loops); defense must be RLS + client guards. |
| **M-2** | `any` types in a few client files (`consignments`, `expenses`) | Reduced type safety; possible runtime surprises. |
| **M-3** | Service role key used only in invite route — other privileged ops still client-side | Acceptable short-term if RLS is applied; long-term migrate sensitive writes to server routes. |

### Low / Informational

| ID | Issue | Notes |
|----|-------|-------|
| **L-1** | Single API route (`POST /api/users/invite`) | Most CRUD is direct Supabase from browser — RLS is the correct control. |
| **L-2** | `roles` SELECT open to all authenticated users | Required for role dropdowns; mutations remain permission-gated. |

---

## B) Actions Taken (Code & SQL)

### 1. Profile privilege escalation fix

**File:** `types/security-rls-migration.sql`

- Added `guard_profile_sensitive_updates()` trigger: non-managers cannot change `role_id`, `is_active`, `employee_id`, or `email` on their own row.
- Tightened `profiles_update` policy to require `is_active_user()` for self-updates.

**File:** `types/rbac-migration.sql`

- Added `is_active_user()` helper and updated `profiles_update` policy (for fresh installs).

### 2. Comprehensive RLS migration

**File:** `types/security-rls-migration.sql`

Enabled RLS and permission-based policies on:

| Domain | Tables | Permission keys |
|--------|--------|-----------------|
| Sales | `sales`, `sale_items` | `can_view_sales`, `can_create_invoice`, `can_edit_sales`, `can_delete_sales` |
| Purchases | `purchases`, `purchase_items` | `can_view_purchases`, `can_create_purchase`, … |
| Catalog | `products`, `categories`, `warehouses`, `inventory_writeoffs` | `can_view_products`, `can_manage_products`, … |
| CRM | `customers`, `suppliers` | `can_view_*`, `can_manage_*` |
| Finance | `accounts`, `transactions`, `expenses`* | `can_view_finance`, `can_manage_finance`, … |
| HR | `employees`, `salary_payments` | `can_view_hr`, `can_manage_hr` |
| Commissions | `commission_rules`, `sales_commissions`, `employee_commission_rules` | `can_view_commissions`, `can_manage_commissions` |
| Consignments | `consignment_orders` | `can_view_consignments`, `can_manage_consignments` |
| Settings | `settings`*, `company_settings`* | `can_view_settings`, `can_manage_settings` |

\*Applied only if the table exists (`DO $$ … END $$` guard).

### 3. Inactive account enforcement

| File | Change |
|------|--------|
| `src/proxy.ts` | Loads `profiles.is_active`; signs out and redirects to `/login?error=account_inactive` |
| `src/components/auth/AuthProvider.tsx` | Signs out inactive users on profile load |
| `src/lib/supabaseServer.ts` | Exposes `isActive` in `getServerAuthContext()` |
| `src/app/login/page.tsx` | Friendly message for `account_inactive` |

### 4. API hardening

| File | Change |
|------|--------|
| `src/lib/auth/apiAuth.ts` | `requireAuthenticatedApi()`, `requirePermissionApi()`, `canAssignRole()` |
| `src/lib/auth/validate.ts` | Email/UUID validation, string clamping |
| `src/app/api/users/invite/route.ts` | Uses shared auth helpers; UUID + length validation; blocks non-admins from assigning Admin role; inactive-user rejection |

---

## C) Production Deployment Recommendations

### Required before go-live

1. **Run SQL migrations in order** (Supabase SQL Editor):
   1. `types/schema.sql` (if not already applied)
   2. `types/rbac-migration.sql`
   3. **`types/security-rls-migration.sql`** ← critical

2. **Verify RLS is enabled:**
   ```sql
   SELECT tablename, rowsecurity
   FROM pg_tables
   WHERE schemaname = 'public'
   ORDER BY tablename;
   ```

3. **Bootstrap at least one Admin** (replace email):
   ```sql
   UPDATE profiles
      SET role_id = (SELECT id FROM roles WHERE name = 'Admin')
    WHERE email = 'admin@yourcompany.az';
   ```

### Vercel environment variables

| Variable | Exposure | Purpose |
|----------|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Browser + server user-scoped client |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | Invite API / admin operations — never prefix with `NEXT_PUBLIC_` |

### Supabase Auth settings

- **Disable public signup** if using invite-only flow (Authentication → Providers → Email).
- **Redirect URLs:** add production URLs for `/auth/callback`, `/auth/set-password`, `/update-password`.
- **JWT expiry:** consider shorter access token lifetime for ERP apps.
- **Leaked password protection:** enable HaveIBeenPwned check if available.

### Supabase database

- Confirm **`auth.uid()`** resolves correctly for authenticated requests (standard Supabase setup).
- Review **Realtime** subscriptions — disable public channels if unused.
- Enable **daily backups** and test restore.
- Audit **Storage buckets** separately if used for logos/uploads.

### Operational security

- Rotate `SUPABASE_SERVICE_ROLE_KEY` if ever exposed in client bundles or logs.
- Use **separate Supabase projects** for staging vs production.
- Monitor Supabase **Auth logs** and **Postgres logs** for `profile_update_forbidden` errors (privilege escalation attempts).
- Consider **rate limiting** on `/api/users/invite` via Vercel middleware or WAF.

### Architecture (future improvements)

- Move high-risk mutations (payroll, finance transfers, user management) to **server actions or API routes** using the service role only after server-side permission checks.
- Add **audit logging** table for admin actions (role changes, user deactivation).
- Replace remaining `any` types in consignment/expense forms.

---

## Defense-in-Depth Model (After Fixes)

```
Request
   │
   ├─► Middleware (proxy.ts)     → Session required; inactive users rejected
   │
   ├─► Client RBAC               → PermissionGuard, Sidebar, action buttons
   │
   ├─► API routes (invite)       → Server session + permission + input validation
   │
   └─► Supabase RLS (PostgreSQL) → require_permission() on every business table
```

**Important:** Client RBAC alone is not sufficient. **RLS migration must be applied in Supabase** for the fixes to be complete in production.

---

## Files Changed in This Audit

| Path | Purpose |
|------|---------|
| `types/security-rls-migration.sql` | New — RLS + profile trigger |
| `types/finance-mutations.sql` | New — atomic expense & payroll PostgreSQL functions |
| `types/rbac-migration.sql` | Updated profiles policy + `is_active_user()` |
| `src/lib/actions/finance.ts` | New — `createExpenseAction`, `createAccountAction` |
| `src/lib/actions/payroll.ts` | New — `processPayrollAction` |
| `src/lib/auth/serverActionAuth.ts` | New — server action permission helpers |
| `src/lib/auth/apiAuth.ts` | New — server API auth helpers |
| `src/lib/auth/validate.ts` | New — input validation |
| `src/app/api/users/invite/route.ts` | Hardened invite endpoint |
| `src/lib/supabaseServer.ts` | `isActive` in auth context |
| `src/proxy.ts` | Inactive user gate |
| `src/components/auth/AuthProvider.tsx` | Inactive user sign-out |
| `src/app/login/page.tsx` | Inactive account message |
| `SECURITY-AUDIT.md` | This report |

---

## Sign-off Checklist

- [ ] `types/security-rls-migration.sql` executed in production Supabase
- [ ] RLS verified on all ERP tables
- [ ] Admin bootstrap account confirmed
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set in Vercel (not public)
- [ ] Public signup disabled (if invite-only)
- [ ] Redirect URLs configured for production domain
- [ ] Test: regular User cannot PATCH own `role_id` to Admin
- [ ] Test: Manager cannot invite Admin role
- [ ] Test: deactivated user redirected to login
