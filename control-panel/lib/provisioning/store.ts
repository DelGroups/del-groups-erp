/**
 * The control-plane side of a provisioning job, through the signed-in admin's Supabase
 * client: RLS lets only platform admins in, and every change is audited.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProvisioningStore } from "./engine.ts";
import { PROVISIONING_STEPS, type JobSnapshot, type ProvisioningStep, type StepRow } from "./steps.ts";

function check<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

const STEP_COLUMNS: Record<string, string> = {
  status: "status",
  attempts: "attempts",
  output: "output",
  error: "error",
  startedAt: "started_at",
  finishedAt: "finished_at",
};

export function supabaseProvisioningStore(supabase: SupabaseClient): ProvisioningStore {
  return {
    async claim(jobId) {
      return check(await supabase.rpc("claim_provisioning_job", { p_job_id: jobId, p_seconds: 150 })) === true;
    },
    async release(jobId) {
      check(await supabase.from("provisioning_jobs").update({ locked_until: null }).eq("id", jobId));
    },
    async load(jobId) {
      const row = check(
        await supabase
          .from("provisioning_jobs")
          .select(
            "id, status, options, current_step, tenants(id, slug, name, language), provisioning_steps(step, position, status, attempts, output, error, started_at, finished_at)"
          )
          .eq("id", jobId)
          .maybeSingle()
      ) as Record<string, unknown> | null;
      return row ? toSnapshot(row) : null;
    },
    async updateStep(jobId, step, patch) {
      const values: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(patch)) values[STEP_COLUMNS[key]] = value;
      check(await supabase.from("provisioning_steps").update(values).eq("job_id", jobId).eq("step", step));
    },
    async updateJob(jobId, patch) {
      const values: Record<string, unknown> = {};
      if (patch.status !== undefined) values.status = patch.status;
      if (patch.currentStep !== undefined) values.current_step = patch.currentStep;
      if (patch.finishedAt !== undefined) values.finished_at = patch.finishedAt;
      check(await supabase.from("provisioning_jobs").update(values).eq("id", jobId));
    },
    async log(jobId, step, level, message) {
      check(await supabase.from("provisioning_log").insert({ job_id: jobId, step, level, message: message.slice(0, 2000) }));
    },
    async setSecret(tenantId, name, value) {
      check(await supabase.rpc("set_tenant_secret", { p_tenant_id: tenantId, p_name: name, p_value: value }));
    },
    async upsertDatabase(tenantId, patch) {
      check(await supabase.from("tenant_databases").upsert({ tenant_id: tenantId, ...patch }, { onConflict: "tenant_id" }));
    },
    async ensurePrimaryDomain(tenantId, domain) {
      const existing = check(
        await supabase.from("tenant_domains").select("domain, is_primary").eq("tenant_id", tenantId)
      ) as { domain: string; is_primary: boolean }[];
      if (existing.some((d) => d.domain === domain)) return;
      check(
        await supabase
          .from("tenant_domains")
          .insert({ tenant_id: tenantId, domain, kind: "subdomain", is_primary: !existing.some((d) => d.is_primary) })
      );
    },
    async setTenantStatus(tenantId, status) {
      check(await supabase.from("tenants").update({ status }).eq("id", tenantId));
    },
    async listModules() {
      const rows = check(
        await supabase.from("modules").select("id, depends").eq("is_active", true).order("id")
      ) as { id: string; depends: string[] | null }[];
      return rows.map((r) => ({ id: r.id, depends: r.depends ?? [] }));
    },
  };
}

export function toSnapshot(row: Record<string, unknown>): JobSnapshot {
  const tenant = (row.tenants ?? {}) as Record<string, string>;
  const steps = ((row.provisioning_steps ?? []) as Record<string, unknown>[])
    .map(
      (s): StepRow => ({
        step: s.step as ProvisioningStep,
        position: Number(s.position),
        status: s.status as StepRow["status"],
        attempts: Number(s.attempts) || 0,
        output: (s.output ?? {}) as Record<string, unknown>,
        error: (s.error as string | null) ?? null,
        startedAt: (s.started_at as string | null) ?? null,
        finishedAt: (s.finished_at as string | null) ?? null,
      })
    )
    .filter((s) => (PROVISIONING_STEPS as readonly string[]).includes(s.step))
    .sort((a, b) => a.position - b.position);
  return {
    id: String(row.id),
    status: row.status as JobSnapshot["status"],
    options: row.options as JobSnapshot["options"],
    currentStep: (row.current_step as string | null) ?? null,
    steps,
    tenant: {
      id: String(tenant.id),
      slug: String(tenant.slug),
      name: String(tenant.name),
      language: (["az", "en", "ru"].includes(tenant.language) ? tenant.language : "az") as JobSnapshot["tenant"]["language"],
    },
  };
}
