/**
 * Builds the provisioning engine's dependencies for a server action: the signed-in admin's
 * control-plane client, the Management API (token from env), the tenant Auth adapter.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { provisioningConfigFromEnv, type ProvisioningConfig } from "./config.ts";
import type { ProvisioningDeps } from "./engine.ts";
import { createManagementApi } from "./managementApi.ts";
import { supabaseProvisioningStore } from "./store.ts";
import { supabaseTenantAuth } from "./tenantAuth.ts";
import { notifyErpTenantChanged } from "../erpWebhook.ts";

export function provisioningConfig(): ReturnType<typeof provisioningConfigFromEnv> {
  return provisioningConfigFromEnv(process.env, process.cwd());
}

/** A database password Supabase accepts (letters and digits, 32 characters). */
export function randomDbPassword(): string {
  return randomBytes(32).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 32).padEnd(32, "x");
}

export function provisioningDeps(supabase: SupabaseClient, config: ProvisioningConfig): ProvisioningDeps {
  return {
    store: supabaseProvisioningStore(supabase),
    api: createManagementApi({ token: config.managementToken, fetch: (input, init) => fetch(input, init) }),
    auth: supabaseTenantAuth,
    config,
    readFile: (path) => readFileSync(path, "utf8"),
    randomPassword: randomDbPassword,
    now: Date.now,
    notifyErp: notifyErpTenantChanged,
  };
}
