/**
 * Daily usage snapshot (prompt 12, plan §4.4): for every tenant with a database, read active
 * users, file storage and this month's AI cost from its own database, store them in
 * usage_snapshots, report what is at 80 % / 100 % of the plan, and copy the subscription's
 * modules and limits to the tenant again (daily self-heal of the sync).
 *
 * Enforcement does not wait for this job: the tenant database measures usage live
 * (public.tenant_limit_status()); the snapshot is the record for the panel and billing.
 */
import { SKIPPED_STATUSES, type TenantTarget } from "../migrations/plan.ts";
import { redactSecrets } from "../provisioning/managementApi.ts";
import { limitState, type LimitState } from "./pricing.ts";
import type { EntitlementRow, SyncOutcome } from "./sync.ts";

/** Runs in the tenant database; one row with one JSON column. ai_usage_log is a core table. */
export const TENANT_USAGE_SQL = `select json_build_object(
  'active_users', (select count(*) from public.profiles where is_active),
  'storage_bytes', (select coalesce(sum((o.metadata ->> 'size')::bigint), 0) from storage.objects o),
  'ai_requests', (select count(*) from public.ai_usage_log where created_at >= date_trunc('month', now())),
  'ai_cost', (select coalesce(sum(cost_usd), 0) from public.ai_usage_log where created_at >= date_trunc('month', now()))
) as usage;`;

export interface TenantUsage {
  active_users: number;
  storage_bytes: number;
  ai_requests: number;
  ai_cost: number;
}

export function parseUsage(rows: unknown): TenantUsage {
  const row = Array.isArray(rows) ? rows[0] : rows;
  const raw = (row && typeof row === "object" && "usage" in row ? (row as { usage: unknown }).usage : row) as Record<string, unknown> | null;
  const n = (v: unknown) => {
    const x = Number(v ?? 0);
    if (!Number.isFinite(x) || x < 0) throw new Error(`bad usage value: ${String(v)}`);
    return x;
  };
  if (!raw || typeof raw !== "object") throw new Error("the tenant returned no usage");
  return {
    active_users: Math.round(n(raw.active_users)),
    storage_bytes: Math.round(n(raw.storage_bytes)),
    ai_requests: Math.round(n(raw.ai_requests)),
    ai_cost: Math.round(n(raw.ai_cost) * 10_000) / 10_000,
  };
}

export interface UsageDeps {
  tenants(): Promise<TenantTarget[]>;
  readUsage(tenant: TenantTarget): Promise<TenantUsage>;
  saveSnapshot(tenantId: string, date: string, usage: TenantUsage): Promise<void>;
  entitlements(tenantId: string): Promise<EntitlementRow | null>;
  sync(tenantId: string): Promise<SyncOutcome>;
  secrets: string[];
  onEvent?(line: string): void;
}

export interface TenantUsageResult {
  slug: string;
  ok: boolean;
  usage: TenantUsage | null;
  states: { users: LimitState; storage: LimitState; ai: LimitState } | null;
  sync: SyncOutcome["status"] | null;
  error: string | null;
}

export interface UsageSummary {
  ok: boolean;
  date: string;
  results: TenantUsageResult[];
  /** "slug: storage 85 %"-style lines for everything at warning or blocked. */
  alerts: string[];
}

const pct = (used: number, limit: number) => `${Math.round((used / limit) * 100)} %`;

export async function runUsageSnapshot(deps: UsageDeps, date: string): Promise<UsageSummary> {
  const summary: UsageSummary = { ok: true, date, results: [], alerts: [] };
  const tenants = (await deps.tenants()).filter(
    (t) => t.projectRef && !(SKIPPED_STATUSES as readonly string[]).includes(t.status)
  );
  for (const tenant of tenants) {
    const result: TenantUsageResult = { slug: tenant.slug, ok: true, usage: null, states: null, sync: null, error: null };
    try {
      const usage = await deps.readUsage(tenant);
      result.usage = usage;
      await deps.saveSnapshot(tenant.id, date, usage);

      const e = await deps.entitlements(tenant.id);
      const storageLimit = e?.storage_limit_bytes === null || e?.storage_limit_bytes === undefined ? null : Number(e.storage_limit_bytes);
      const aiLimit = e?.ai_limit_usd === null || e?.ai_limit_usd === undefined ? null : Number(e.ai_limit_usd);
      result.states = {
        users: limitState(usage.active_users, e ? e.seat_limit : null),
        storage: limitState(usage.storage_bytes, storageLimit),
        ai: limitState(usage.ai_cost, aiLimit),
      };
      if (e) {
        if (["warning", "blocked"].includes(result.states.users)) summary.alerts.push(`${tenant.slug}: users ${usage.active_users}/${e.seat_limit} (${result.states.users})`);
        if (storageLimit && ["warning", "blocked"].includes(result.states.storage)) summary.alerts.push(`${tenant.slug}: storage ${pct(usage.storage_bytes, storageLimit)} (${result.states.storage})`);
        if (aiLimit && ["warning", "blocked"].includes(result.states.ai)) summary.alerts.push(`${tenant.slug}: AI ${pct(usage.ai_cost, aiLimit)} (${result.states.ai})`);
      }

      const sync = await deps.sync(tenant.id);
      result.sync = sync.status;
      if (sync.status === "failed") {
        result.ok = false;
        result.error = `sync: ${sync.error}`;
      }
      deps.onEvent?.(
        `[${tenant.slug}] users ${usage.active_users}, storage ${usage.storage_bytes} B, AI ${usage.ai_cost} USD this month; sync ${sync.status}`
      );
    } catch (error) {
      result.ok = false;
      result.error = redactSecrets(error instanceof Error ? error.message : String(error), deps.secrets);
      deps.onEvent?.(`[${tenant.slug}] FAILED ${result.error}`);
    }
    if (!result.ok) summary.ok = false;
    summary.results.push(result);
  }
  return summary;
}
