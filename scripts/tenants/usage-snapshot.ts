/**
 * Daily usage snapshot of every tenant (prompt 12). See control-panel/lib/billing/usage.ts.
 *
 *   npm run tenants:usage                 # all tenants, today (UTC)
 *   npm run tenants:usage -- --local      # local Postgres rehearsal (CONTROL_PLANE_DB_URL,
 *                                         #  TENANT_DATABASE_URLS {"<slug>": "<url>"})
 *
 * For each tenant with a database (not provisioning or cancelled): reads active users,
 * file storage and this month's AI cost from the tenant database, upserts usage_snapshots,
 * prints what is at 80 % / 100 % of the plan, and copies the subscription's modules and
 * limits to the tenant again. Runs in GitHub Actions (tenant-usage workflow) with
 * CONTROL_PLANE_URL, CONTROL_PLANE_SERVICE_ROLE_KEY and SUPABASE_MANAGEMENT_API_TOKEN.
 *
 * Exit code: 0 all tenants done, 1 a tenant failed (the others still ran), 2 bad settings.
 */
import { appendFileSync } from "node:fs";
import { createManagementApi, redactSecrets, type ManagementApi } from "../../control-panel/lib/provisioning/managementApi.ts";
import { supabaseMigrationStore } from "../../control-panel/lib/migrations/store.ts";
import { supabaseSyncStore } from "../../control-panel/lib/billing/store.ts";
import { syncTenant } from "../../control-panel/lib/billing/sync.ts";
import { parseUsage, runUsageSnapshot, TENANT_USAGE_SQL, type UsageDeps, type UsageSummary } from "../../control-panel/lib/billing/usage.ts";
import { localStore, refuseHosted } from "./local.ts";
import { localBilling } from "./local-billing.ts";

function fail(message: string): never {
  console.error(`usage-snapshot: ${message}`);
  process.exit(2);
}
const env = (name: string): string => (process.env[name] ?? "").trim() || fail(`${name} is not set`);

async function remoteDeps(): Promise<UsageDeps> {
  const serviceKey = env("CONTROL_PLANE_SERVICE_ROLE_KEY");
  const token = env("SUPABASE_MANAGEMENT_API_TOKEN");
  const { createClient } = await import("@supabase/supabase-js");
  // The repo root and control-panel/ each have their own copy of supabase-js; same API.
  const supabase = createClient(env("CONTROL_PLANE_URL"), serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as Parameters<typeof supabaseSyncStore>[0];
  const api = createManagementApi({ token, fetch: (input, init) => fetch(input, init) });
  const store = supabaseSyncStore(supabase);
  const secrets = [serviceKey, token];
  return {
    secrets,
    tenants: () => supabaseMigrationStore(supabase).listTenants(),
    readUsage: async (t) => parseUsage(await api.runQuery(t.projectRef!, TENANT_USAGE_SQL)),
    async saveSnapshot(tenantId, date, u) {
      const { error } = await supabase
        .from("usage_snapshots")
        .upsert({ tenant_id: tenantId, snapshot_date: date, ...u }, { onConflict: "tenant_id,snapshot_date" });
      if (error) throw new Error(error.message);
    },
    entitlements: (id) => store.entitlements(id),
    sync: (id) => syncTenant({ store, api, secrets }, id),
    onEvent: (line) => console.log(line),
  };
}

function localDeps(): UsageDeps {
  const cp = env("CONTROL_PLANE_DB_URL");
  let urls: Record<string, string> = {};
  try {
    urls = JSON.parse(env("TENANT_DATABASE_URLS"));
  } catch {
    fail('TENANT_DATABASE_URLS must be JSON: {"<slug>": "postgresql://..."}');
  }
  for (const u of [cp, ...Object.values(urls)]) refuseHosted(u, fail);
  const local = localBilling(cp, urls);
  return {
    secrets: [],
    tenants: () => localStore(cp).listTenants(),
    readUsage: async (t) => parseUsage(await local.readUsage(t, TENANT_USAGE_SQL)),
    saveSnapshot: (id, date, u) => local.saveSnapshot(id, date, u),
    entitlements: (id) => local.syncStore.entitlements(id),
    sync: (id) => syncTenant({ store: local.syncStore, api: local.api as unknown as ManagementApi, secrets: [] }, id),
    onEvent: (line) => console.log(line),
  };
}

function report(s: UsageSummary): string {
  const lines = [
    `### Tenant usage ${s.date}`,
    "",
    "| Tenant | Users | Storage (GB) | AI this month (USD) | Limits | Sync | Error |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const r of s.results) {
    const u = r.usage;
    const states = r.states ? `users ${r.states.users}, storage ${r.states.storage}, AI ${r.states.ai}` : "";
    lines.push(
      `| ${r.slug} | ${u?.active_users ?? ""} | ${u ? (u.storage_bytes / 1024 ** 3).toFixed(2) : ""} | ${u?.ai_cost ?? ""} | ${states} | ${r.sync ?? ""} | ${(r.error ?? "").replace(/\|/g, "\\|")} |`
    );
  }
  lines.push(
    "",
    s.alerts.length ? `**At or above 80 %:** ${s.alerts.join("; ")}` : "No tenant is at 80 % of a limit.",
    "",
    s.ok ? "Result: OK" : "Result: FAILED"
  );
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  for (const a of args) if (a !== "--local") fail(`unknown option ${a}`);
  const deps = args.includes("--local") ? localDeps() : await remoteDeps();
  const summary = await runUsageSnapshot(deps, new Date().toISOString().slice(0, 10));
  const text = report(summary);
  console.log(`\n${text}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  process.exit(summary.ok ? 0 : 1);
}

main().catch((error) => {
  const keys = ["CONTROL_PLANE_SERVICE_ROLE_KEY", "SUPABASE_MANAGEMENT_API_TOKEN"].map((k) => process.env[k] ?? "");
  console.error(`usage-snapshot: ${redactSecrets(error instanceof Error ? error.message : String(error), keys)}`);
  process.exit(1);
});
