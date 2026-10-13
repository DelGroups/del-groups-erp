/**
 * --local stand-ins for the subscription sync and the usage job (prompt 12): the control
 * plane and the tenant databases are local Postgres databases reached with psql.
 * Tenant databases are keyed by slug (TENANT_DATABASE_URLS), so here a tenant's "project
 * ref" is its slug.
 */
import type { TenantTarget } from "../../control-panel/lib/migrations/plan.ts";
import type { EntitlementRow, SyncStore } from "../../control-panel/lib/billing/sync.ts";
import type { TenantUsage } from "../../control-panel/lib/billing/usage.ts";
import type { BillingStore, SettingsRow, WorkItem } from "../../control-panel/lib/billing/run.ts";
import { pdfPath, toInvoiceDocument } from "../../control-panel/lib/billing/billingStore.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { psql } from "./local.ts";

export function localBilling(controlPlaneUrl: string, urls: Record<string, string>) {
  const tenantUrl = (key: string) => {
    const u = urls[key];
    if (!u) throw new Error(`no database URL for ${key} in TENANT_DATABASE_URLS`);
    return u;
  };

  const syncStore: SyncStore = {
    async entitlements(tenantId) {
      const rows = JSON.parse(
        psql(controlPlaneUrl, `select coalesce(json_agg(e), '[]') from public.tenant_entitlements(:'tid'::uuid) e;`, { tid: tenantId }) || "[]"
      ) as EntitlementRow[];
      return rows[0] ?? null;
    },
    async allModules() {
      return JSON.parse(psql(controlPlaneUrl, `select coalesce(json_agg(id order by id), '[]') from public.modules where is_active;`)) as string[];
    },
    async projectRef(tenantId) {
      const slug = psql(controlPlaneUrl, `select slug from public.tenants where id = :'tid'::uuid;`, { tid: tenantId });
      return slug && urls[slug] ? slug : null;
    },
    async recordSync(subscriptionId, result) {
      psql(
        controlPlaneUrl,
        `update public.subscriptions set sync_status = :'s', sync_error = nullif(:'e', ''),
           synced_at = case when :'s' = 'synced' then now() else synced_at end
         where id = :'id'::uuid;`,
        { id: subscriptionId, s: result.status, e: result.error ?? "" }
      );
    },
  };

  return {
    syncStore,
    /** Management-API-shaped: runs the SQL in the tenant database named by `ref` (its slug). */
    api: {
      async runQuery<T>(ref: string, query: string): Promise<T[]> {
        psql(tenantUrl(ref), query);
        return [];
      },
    },
    async readUsage(tenant: TenantTarget, sql: string): Promise<unknown> {
      return [{ usage: JSON.parse(psql(tenantUrl(tenant.slug), sql)) }];
    },
    async saveSnapshot(tenantId: string, date: string, u: TenantUsage) {
      psql(
        controlPlaneUrl,
        `insert into public.usage_snapshots (tenant_id, snapshot_date, active_users, storage_bytes, ai_requests, ai_cost)
         values (:'tid'::uuid, :'d'::date, :'u'::int, :'s'::bigint, :'r'::int, :'c'::numeric)
         on conflict (tenant_id, snapshot_date) do update set active_users = excluded.active_users,
           storage_bytes = excluded.storage_bytes, ai_requests = excluded.ai_requests, ai_cost = excluded.ai_cost;`,
        { tid: tenantId, d: date, u: String(u.active_users), s: String(u.storage_bytes), r: String(u.ai_requests), c: String(u.ai_cost) }
      );
    },
  };
}

/**
 * --local BillingStore for scripts/tenants/billing-run.ts: the control plane is a local
 * Postgres database reached with psql, and invoice PDFs are files under `pdfDir` (instead of
 * the Storage bucket). Same SQL functions as the Supabase store.
 */
export function localBillingStore(controlPlaneUrl: string, pdfDir: string): BillingStore {
  const q = (sql: string, vars: Record<string, string> = {}) => psql(controlPlaneUrl, sql, vars);
  const json = <T>(sql: string, vars: Record<string, string> = {}): T => JSON.parse(q(sql, vars) || "null") as T;
  return {
    async settings() {
      return json<SettingsRow>(`select to_json(s) from public.billing_settings s where id;`);
    },
    async worklist() {
      return json<WorkItem[]>(`select public.billing_worklist();`) ?? [];
    },
    async workItem(tenantId) {
      return json<WorkItem | null>(`select public.billing_work_item(:'tid'::uuid);`, { tid: tenantId });
    },
    async catalog() {
      return json<{ id: string; depends: string[]; is_core: boolean }[]>(
        `select coalesce(json_agg(json_build_object('id', id, 'depends', depends, 'is_core', is_core) order by id), '[]') from public.modules where is_active;`
      ).map((m) => ({ id: m.id, depends: m.depends ?? [], isCore: m.is_core }));
    },
    async markOverdue(today) {
      return Number(q(`select public.mark_overdue_invoices(:'d'::date);`, { d: today }));
    },
    async issueInvoice(input) {
      return json(`select public.issue_invoice(:'p'::jsonb);`, { p: JSON.stringify(input) });
    },
    async advancePeriod(subscriptionId, fromEnd, newEnd) {
      return q(`select public.advance_subscription_period(:'s'::uuid, :'f'::date, :'n'::date);`, { s: subscriptionId, f: fromEnd, n: newEnd }) === "t";
    },
    async invoiceDocument(invoiceId) {
      return toInvoiceDocument(
        json(
          `select to_jsonb(i) || jsonb_build_object('invoice_lines', coalesce((select jsonb_agg(to_jsonb(l)) from public.invoice_lines l where l.invoice_id = i.id), '[]'))
             from public.invoices i where i.id = :'id'::uuid;`,
          { id: invoiceId }
        )
      );
    },
    async savePdf(invoice, pdf) {
      const path = pdfPath(invoice.tenantId, invoice.number);
      mkdirSync(dirname(join(pdfDir, path)), { recursive: true });
      writeFileSync(join(pdfDir, path), pdf);
      q(`update public.invoices set pdf_path = :'p' where id = :'id'::uuid;`, { p: path, id: invoice.id });
      return path;
    },
    async setStatus(tenantId, status) {
      return q(`select public.set_billing_status(:'tid'::uuid, :'s');`, { tid: tenantId, s: status }) === "t";
    },
    async recordPayment(input) {
      return json(`select public.record_payment(:'p'::jsonb);`, { p: JSON.stringify(input) });
    },
    async noteChargeAttempt(invoiceId) {
      q(`update public.invoices set charge_attempts = charge_attempts + 1, last_charge_attempt_at = now() where id = :'id'::uuid;`, { id: invoiceId });
    },
    async defaultCard(tenantId, provider) {
      return json(
        `select json_build_object('id', id, 'token', public.payment_method_token(id)) from public.payment_methods
          where tenant_id = :'tid'::uuid and provider = :'p' and is_default;`,
        { tid: tenantId, p: provider }
      );
    },
    async claimEmail(row) {
      const id = q(
        `with ins as (
           insert into public.billing_emails (tenant_id, invoice_id, kind, recipient, subject, status)
           values (:'tid'::uuid, nullif(:'inv', '')::uuid, :'k', nullif(:'to', ''), :'subj', 'pending')
           on conflict (invoice_id, kind) where invoice_id is not null do nothing
           returning id
         ), retry as (
           update public.billing_emails set status = 'pending', error = null
            where invoice_id = nullif(:'inv', '')::uuid and kind = :'k' and status = 'failed' and not exists (select 1 from ins)
           returning id
         )
         select id from ins union all select id from retry;`,
        { tid: row.tenant_id, inv: row.invoice_id ?? "", k: row.kind, to: row.recipient ?? "", subj: row.subject }
      );
      return id || null;
    },
    async finishEmail(id, result) {
      q(
        `update public.billing_emails set status = :'s', error = nullif(:'e', ''), provider_message_id = nullif(:'m', ''),
                sent_at = case when :'s' = 'sent' then now() end where id = :'id'::uuid;`,
        { id, s: result.status, e: result.error ?? "", m: result.provider_message_id ?? "" }
      );
    },
  };
}
