/**
 * The provisioning steps (docs/SaaS-Commercialization-Plan.md §4.3), in order. Each step is
 * idempotent: running it again after a success or a half-finished failure is safe.
 */
export const PROVISIONING_STEPS = [
  "create_project",
  "wait_healthy",
  "store_keys",
  "apply_schema",
  "configure_auth",
  "storage_buckets",
  "seed_modules",
  "register_domain",
  "invite_admin",
  "activate",
] as const;
export type ProvisioningStep = (typeof PROVISIONING_STEPS)[number];

export type StepStatus = "pending" | "running" | "succeeded" | "failed";
export type JobStatus = "running" | "failed" | "succeeded";

/** Final tenant status once the ERP works. */
export const FINAL_STATUSES = ["trial", "active"] as const;
export type FinalStatus = (typeof FINAL_STATUSES)[number];

export interface ProvisioningOptions {
  /** Modules chosen in the panel (core is always added, dependencies too). */
  modules: string[];
  adminEmail: string;
  adminName: string;
  finalStatus: FinalStatus;
}

export interface StepRow {
  step: ProvisioningStep;
  position: number;
  status: StepStatus;
  attempts: number;
  /** Non-secret results, e.g. { project_ref } or { applied: 5, total: 20 }. */
  output: Record<string, unknown>;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface JobSnapshot {
  id: string;
  status: JobStatus;
  options: ProvisioningOptions;
  currentStep: string | null;
  steps: StepRow[];
  tenant: { id: string; slug: string; name: string; language: "az" | "en" | "ru" };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type OptionErrors = Partial<Record<"modules" | "adminEmail" | "adminName" | "finalStatus", string>>;

/** Validates the panel's provisioning form. Error values are i18n keys (provisioning.errors). */
export function parseProvisioningOptions(
  raw: { modules?: unknown; adminEmail?: unknown; adminName?: unknown; finalStatus?: unknown },
  knownModules: readonly string[]
): { ok: true; value: ProvisioningOptions } | { ok: false; errors: OptionErrors } {
  const errors: OptionErrors = {};
  const list = Array.isArray(raw.modules) ? raw.modules.map(String) : [];
  const unknown = list.filter((m) => !knownModules.includes(m));
  if (unknown.length) errors.modules = "modulesUnknown";
  const adminEmail = typeof raw.adminEmail === "string" ? raw.adminEmail.trim().toLowerCase() : "";
  if (!EMAIL.test(adminEmail) || adminEmail.length > 254) errors.adminEmail = "emailInvalid";
  const adminName = typeof raw.adminName === "string" ? raw.adminName.trim() : "";
  if (!adminName || adminName.length > 200) errors.adminName = "nameRequired";
  const finalStatus = typeof raw.finalStatus === "string" && raw.finalStatus ? raw.finalStatus : "trial";
  if (!(FINAL_STATUSES as readonly string[]).includes(finalStatus)) errors.finalStatus = "statusInvalid";
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      modules: [...new Set(["core", ...list])],
      adminEmail,
      adminName,
      finalStatus: finalStatus as FinalStatus,
    },
  };
}
