"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notifyErpTenantChanged } from "@/lib/erpWebhook";
import { advanceJob, retryJob, type AdvanceResult } from "@/lib/provisioning/engine";
import { provisioningConfig, provisioningDeps } from "@/lib/provisioning/server";
import { supabaseProvisioningStore } from "@/lib/provisioning/store";
import { loadProvisioningView, type ProvisioningView } from "./view";
import {
  PROVISIONING_STEPS,
  parseProvisioningOptions,
  type OptionErrors,
} from "@/lib/provisioning/steps";

export interface StartState {
  status: "idle" | "error" | "started";
  /** i18n keys under provisioning.errors */
  errors: OptionErrors;
  formError: string | null;
}

const UNIQUE_VIOLATION = "23505";

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function viewForJob(supabase: Supabase, jobId: string): Promise<ProvisioningView> {
  const { data } = await supabase.from("provisioning_jobs").select("tenant_id").eq("id", jobId).maybeSingle();
  return data ? loadProvisioningView(supabase, data.tenant_id as string) : { job: null, log: [] };
}

export async function startProvisioning(tenantId: string, _prev: StartState, formData: FormData): Promise<StartState> {
  await requireAdmin();
  const { config } = provisioningConfig();
  if (!config) return { status: "error", errors: {}, formError: "startFailed" };

  const supabase = await createClient();
  const store = supabaseProvisioningStore(supabase);
  const known = (await store.listModules()).map((m) => m.id);
  const parsed = parseProvisioningOptions(
    {
      modules: formData.getAll("modules"),
      adminEmail: formData.get("adminEmail"),
      adminName: formData.get("adminName"),
      finalStatus: formData.get("finalStatus"),
    },
    known
  );
  if (!parsed.ok) return { status: "error", errors: parsed.errors, formError: null };

  const { data: database } = await supabase
    .from("tenant_databases")
    .select("supabase_project_ref")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (database?.supabase_project_ref) return { status: "error", errors: {}, formError: "alreadyStarted" };

  const { data: job, error } = await supabase
    .from("provisioning_jobs")
    .insert({ tenant_id: tenantId, status: "running", options: parsed.value })
    .select("id")
    .single();
  if (error || !job) {
    return { status: "error", errors: {}, formError: error?.code === UNIQUE_VIOLATION ? "alreadyStarted" : "startFailed" };
  }
  const { error: stepsError } = await supabase
    .from("provisioning_steps")
    .insert(PROVISIONING_STEPS.map((step, position) => ({ job_id: job.id, step, position })));
  if (stepsError) return { status: "error", errors: {}, formError: "startFailed" };

  await store.setTenantStatus(tenantId, "provisioning");
  await store.log(job.id, null, "info", `provisioning started with modules: ${parsed.value.modules.join(", ")}`);
  await notifyErpTenantChanged(tenantId);
  revalidatePath(`/tenants/${tenantId}`);
  return { status: "started", errors: {}, formError: null };
}

/** Runs the next unit of the job and returns the new state. */
export async function advanceProvisioning(jobId: string): Promise<{ result: AdvanceResult; view: ProvisioningView }> {
  await requireAdmin();
  const supabase = await createClient();
  const { config } = provisioningConfig();
  const result = config ? await advanceJob(provisioningDeps(supabase, config), jobId) : "failed";
  return { result, view: await viewForJob(supabase, jobId) };
}

/** Puts the failed step back in the queue. */
export async function retryProvisioning(jobId: string): Promise<ProvisioningView> {
  await requireAdmin();
  const supabase = await createClient();
  await retryJob(supabaseProvisioningStore(supabase), jobId);
  return viewForJob(supabase, jobId);
}
