import type { createClient } from "@/lib/supabase/server";
import { toSnapshot } from "@/lib/provisioning/store";
import type { JobSnapshot } from "@/lib/provisioning/steps";

export interface LogLine {
  id: number;
  step: string | null;
  level: "info" | "warn" | "error";
  message: string;
  created_at: string;
}

export interface ProvisioningView {
  job: JobSnapshot | null;
  log: LogLine[];
}

const LOG_LIMIT = 300;

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** The tenant's latest job (any status) and its log, for the tenant page. */
export async function loadProvisioningView(supabase: Supabase, tenantId: string): Promise<ProvisioningView> {
  const { data } = await supabase
    .from("provisioning_jobs")
    .select(
      "id, status, options, current_step, tenants(id, slug, name, language), provisioning_steps(step, position, status, attempts, output, error, started_at, finished_at)"
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return { job: null, log: [] };
  const job = toSnapshot(data as Record<string, unknown>);
  const { data: log } = await supabase
    .from("provisioning_log")
    .select("id, step, level, message, created_at")
    .eq("job_id", job.id)
    .order("id", { ascending: false })
    .limit(LOG_LIMIT);
  return { job, log: ((log ?? []) as LogLine[]).reverse() };
}

