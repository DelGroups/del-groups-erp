/**
 * Runs a provisioning job one unit at a time (a step, or one SQL file of the schema step).
 * The tenant page calls advanceJob() repeatedly while the job runs, so no background worker
 * is needed and the job resumes from the stored state after any interruption.
 *
 * Every step is idempotent; secrets go to Vault (store.setSecret) and are never written to
 * step output or the log. Errors are redacted before they are stored.
 */
import { PROVISIONING_STEPS, type JobSnapshot, type ProvisioningStep, type StepRow } from "./steps.ts";
import type { ProvisioningConfig } from "./config.ts";
import { redactSecrets, type ManagementApi } from "./managementApi.ts";
import {
  baselineVersion,
  expectedBuckets,
  moduleClosure,
  schemaFiles,
  tenantModulesSql,
  type ModuleRow,
} from "./plan.ts";
import { authEmailConfig } from "./emails.ts";

export interface ProvisioningStore {
  /** Takes the job for a while; false when another tab is running it. */
  claim(jobId: string): Promise<boolean>;
  release(jobId: string): Promise<void>;
  load(jobId: string): Promise<JobSnapshot | null>;
  updateStep(
    jobId: string,
    step: ProvisioningStep,
    patch: Partial<Pick<StepRow, "status" | "attempts" | "output" | "error" | "startedAt" | "finishedAt">>
  ): Promise<void>;
  updateJob(jobId: string, patch: { status?: JobSnapshot["status"]; currentStep?: string | null; finishedAt?: string | null }): Promise<void>;
  log(jobId: string, step: ProvisioningStep | null, level: "info" | "warn" | "error", message: string): Promise<void>;
  setSecret(tenantId: string, name: string, value: string): Promise<void>;
  upsertDatabase(tenantId: string, patch: Record<string, string | null>): Promise<void>;
  ensurePrimaryDomain(tenantId: string, domain: string): Promise<void>;
  setTenantStatus(tenantId: string, status: string): Promise<void>;
  listModules(): Promise<ModuleRow[]>;
}

export interface TenantAuth {
  /** Invites the tenant's first admin (role Admin). "exists" when the user is already there. */
  inviteAdmin(input: {
    apiUrl: string;
    serviceRoleKey: string;
    email: string;
    fullName: string;
    redirectTo: string;
  }): Promise<"invited" | "exists">;
}

export interface ProvisioningDeps {
  store: ProvisioningStore;
  api: ManagementApi;
  auth: TenantAuth;
  config: ProvisioningConfig;
  readFile(path: string): string;
  randomPassword(): string;
  now(): number;
  /** Tells the ERP to drop its tenant cache (optional). */
  notifyErp?(tenantId: string): Promise<void>;
}

export type AdvanceResult = "progress" | "waiting" | "done" | "failed" | "busy";

type Outcome =
  | { kind: "done"; output?: Record<string, unknown>; message: string }
  | { kind: "progress" | "waiting"; output?: Record<string, unknown>; message: string };

const HEALTH_SERVICES = ["auth", "db", "rest", "storage"] as const;
const HEALTH_TIMEOUT_MS = 30 * 60_000;

/** https://<ref>.supabase.co, the API URL the ERP derives from the project ref too. */
export function projectApiUrl(ref: string): string {
  return `https://${ref}.supabase.co`;
}

export function tenantDomain(slug: string, config: ProvisioningConfig): string {
  return `${slug}.${config.baseDomain}`;
}

function stepOutput(job: JobSnapshot, step: ProvisioningStep): Record<string, unknown> {
  return job.steps.find((s) => s.step === step)?.output ?? {};
}

function projectRef(job: JobSnapshot): string {
  const ref = stepOutput(job, "create_project").project_ref;
  if (typeof ref !== "string" || !ref) throw new Error("no project yet (create_project has not finished)");
  return ref;
}

async function runStep(step: StepRow, job: JobSnapshot, deps: ProvisioningDeps): Promise<Outcome> {
  const { api, store, config } = deps;
  const tenant = job.tenant;
  const siteUrl = `https://${tenantDomain(tenant.slug, config)}`;
  const modules = async () => moduleClosure(job.options.modules, await store.listModules());

  switch (step.step) {
    case "create_project": {
      if (typeof step.output.project_ref === "string") return { kind: "done", message: "project already created" };
      const name = `erp-${tenant.slug}`;
      // A previous attempt may have created it without recording the ref.
      const existing = (await api.listProjects()).find((p) => p.name === name);
      if (existing) {
        await store.upsertDatabase(tenant.id, { supabase_project_ref: existing.ref, region: existing.region || null });
        return { kind: "done", output: { project_ref: existing.ref, region: existing.region }, message: `found project ${name} (${existing.ref})` };
      }
      const dbPass = deps.randomPassword();
      await store.setSecret(tenant.id, "db_password", dbPass);
      const created = await api.createProject({
        name,
        organizationSlug: config.organizationSlug,
        dbPass,
        regionGroup: config.regionGroup,
      });
      await store.upsertDatabase(tenant.id, { supabase_project_ref: created.ref, region: created.region || null });
      return {
        kind: "done",
        output: { project_ref: created.ref, region: created.region },
        message: `created project ${name} (${created.ref}) in ${created.region || config.regionGroup}; database password stored in Vault`,
      };
    }

    case "wait_healthy": {
      const health = await api.getHealth(projectRef(job), HEALTH_SERVICES);
      const healthy = HEALTH_SERVICES.every((s) => health.find((h) => h.name === s)?.healthy);
      if (healthy) return { kind: "done", message: "all services are ACTIVE_HEALTHY" };
      const started = step.startedAt ? Date.parse(step.startedAt) : deps.now();
      if (deps.now() - started > HEALTH_TIMEOUT_MS) throw new Error("the project did not become healthy within 30 minutes");
      const summary = HEALTH_SERVICES.map((s) => `${s}: ${health.find((h) => h.name === s)?.status || "unknown"}`).join(", ");
      return { kind: "waiting", message: `waiting for the project (${summary})` };
    }

    case "store_keys": {
      const keys = await api.getKeys(projectRef(job));
      await store.setSecret(tenant.id, "supabase_anon_key", keys.anonKey);
      await store.setSecret(tenant.id, "supabase_service_role_key", keys.serviceRoleKey);
      return { kind: "done", output: { key_kind: keys.kind }, message: `stored the ${keys.kind} API keys in Vault` };
    }

    case "apply_schema": {
      const files = schemaFiles(config.sqlDir, await modules());
      const applied = typeof step.output.applied === "number" ? step.output.applied : 0;
      if (applied < files.length) {
        const file = files[applied];
        await api.applyMigration(projectRef(job), file.name, deps.readFile(file.path));
        const output = { applied: applied + 1, total: files.length, last: file.name };
        const message = `applied ${file.name} (${applied + 1}/${files.length})`;
        if (applied + 1 < files.length) return { kind: "progress", output, message };
        await store.upsertDatabase(tenant.id, {
          schema_version: baselineVersion(config.sqlDir),
          last_migration: file.name,
          last_migrated_at: new Date(deps.now()).toISOString(),
        });
        return { kind: "done", output, message: `${message}; schema complete` };
      }
      return { kind: "done", message: "schema already applied" };
    }

    case "configure_auth": {
      await api.updateAuthConfig(projectRef(job), {
        site_url: siteUrl,
        uri_allow_list: `${siteUrl}/**`,
        disable_signup: true,
        ...authEmailConfig(tenant.language, tenant.name),
      });
      return { kind: "done", output: { site_url: siteUrl }, message: `auth site URL ${siteUrl}, invite-only, emails in ${tenant.language}` };
    }

    case "storage_buckets": {
      const expected = expectedBuckets(schemaFiles(config.sqlDir, await modules()));
      const rows = await api.runQuery<{ id: string }>(projectRef(job), "select id from storage.buckets order by id;");
      const present = new Set(rows.map((r) => r.id));
      const missing = expected.filter((id) => !present.has(id));
      if (missing.length) throw new Error(`storage buckets missing after the schema: ${missing.join(", ")}`);
      return { kind: "done", output: { buckets: expected }, message: `buckets present: ${expected.join(", ") || "none"}` };
    }

    case "seed_modules": {
      const all = (await store.listModules()).map((m) => m.id);
      const enabled = await modules();
      await api.runQuery(projectRef(job), tenantModulesSql(all, enabled));
      return { kind: "done", output: { enabled }, message: `modules enabled: ${enabled.join(", ")}` };
    }

    case "register_domain": {
      const domain = tenantDomain(tenant.slug, config);
      await store.ensurePrimaryDomain(tenant.id, domain);
      return { kind: "done", output: { domain }, message: `primary domain ${domain}` };
    }

    case "invite_admin": {
      const ref = projectRef(job);
      // Fetched fresh: the control panel never reads keys back from Vault.
      const keys = await api.getKeys(ref);
      const result = await deps.auth.inviteAdmin({
        apiUrl: projectApiUrl(ref),
        serviceRoleKey: keys.serviceRoleKey,
        email: job.options.adminEmail,
        fullName: job.options.adminName,
        redirectTo: `${siteUrl}/auth/set-password`,
      });
      return {
        kind: "done",
        output: { email: job.options.adminEmail, result },
        message: result === "invited" ? `invited ${job.options.adminEmail} as Admin` : `${job.options.adminEmail} already exists`,
      };
    }

    case "activate": {
      await store.setTenantStatus(tenant.id, job.options.finalStatus);
      await deps.notifyErp?.(tenant.id);
      return { kind: "done", output: { status: job.options.finalStatus }, message: `tenant is ${job.options.finalStatus} at ${siteUrl}` };
    }
  }
}

/** Runs the next unit of work of a job. */
export async function advanceJob(deps: ProvisioningDeps, jobId: string): Promise<AdvanceResult> {
  const { store } = deps;
  if (!(await store.claim(jobId))) return "busy";
  let current: ProvisioningStep | null = null;
  try {
    const job = await store.load(jobId);
    if (!job) return "failed";
    if (job.status === "succeeded") return "done";
    if (job.status === "failed") return "failed";

    const ordered = [...job.steps].sort((a, b) => a.position - b.position);
    const next = ordered.find((s) => s.status !== "succeeded");
    if (!next) {
      await store.updateJob(jobId, { status: "succeeded", currentStep: null, finishedAt: new Date(deps.now()).toISOString() });
      return "done";
    }
    if (next.status === "failed") return "failed";
    current = next.step;

    if (next.status === "pending") {
      const startedAt = new Date(deps.now()).toISOString();
      await store.updateStep(jobId, next.step, { status: "running", attempts: next.attempts + 1, startedAt, error: null });
      await store.updateJob(jobId, { currentStep: next.step });
      await store.log(jobId, next.step, "info", `started (attempt ${next.attempts + 1})`);
      next.status = "running";
      next.startedAt = startedAt;
    }

    const outcome = await runStep(next, job, deps);
    const output = outcome.output ? { ...next.output, ...outcome.output } : next.output;
    await store.log(jobId, next.step, "info", redactSecrets(outcome.message, [deps.config.managementToken]));

    if (outcome.kind !== "done") {
      await store.updateStep(jobId, next.step, { output });
      return outcome.kind;
    }
    await store.updateStep(jobId, next.step, { status: "succeeded", output, finishedAt: new Date(deps.now()).toISOString() });
    if (next.step === PROVISIONING_STEPS[PROVISIONING_STEPS.length - 1]) {
      await store.updateJob(jobId, { status: "succeeded", currentStep: null, finishedAt: new Date(deps.now()).toISOString() });
      await store.log(jobId, null, "info", "provisioning finished");
      return "done";
    }
    return "progress";
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error), [deps.config.managementToken]);
    if (current) await store.updateStep(jobId, current, { status: "failed", error: message });
    await store.updateJob(jobId, { status: "failed" });
    await store.log(jobId, current, "error", message);
    return "failed";
  } finally {
    await store.release(jobId);
  }
}

/** Puts the failed step back to pending so the next advanceJob() tries it again. */
export async function retryJob(store: ProvisioningStore, jobId: string): Promise<boolean> {
  const job = await store.load(jobId);
  if (!job || job.status !== "failed") return false;
  const failed = job.steps.find((s) => s.status === "failed");
  if (failed) await store.updateStep(jobId, failed.step, { status: "pending", error: null });
  await store.updateJob(jobId, { status: "running" });
  await store.log(jobId, failed?.step ?? null, "info", "retry requested");
  return true;
}
