import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  getTenantConfig,
  parsePublicTenantConfig,
  PUBLIC_CONFIG_GLOBAL,
  supabaseClientCredentials,
  toPublicTenantConfig,
  type PublicTenantConfig,
  type SupabaseConfigIssue,
} from "@/lib/tenant/config";

let browserClient: SupabaseClient<Database> | null = null;
let browserConfig: PublicTenantConfig | null = null;
let loadPromise: Promise<boolean> | null = null;
let runtimeIssue: SupabaseConfigIssue = null;
let runtimeUrlPreview = "";

/**
 * Config known without a network call, in priority order: what the root
 * layout embedded for this tenant, then the NEXT_PUBLIC_* values a build may
 * have inlined (fallback for builds made with them).
 */
function knownConfig(): PublicTenantConfig | null {
  if (typeof window !== "undefined") {
    const embedded = parsePublicTenantConfig(
      (window as unknown as Record<string, unknown>)[PUBLIC_CONFIG_GLOBAL]
    );
    if (embedded) return embedded;
  }
  return toPublicTenantConfig(getTenantConfig());
}

function applyConfig(config: PublicTenantConfig) {
  if (browserClient && browserConfig?.url === config.url && browserConfig.anonKey === config.anonKey) {
    return;
  }
  browserClient = createBrowserClient<Database>(config.url, config.anonKey);
  browserConfig = config;
  runtimeIssue = null;
  runtimeUrlPreview = config.url.slice(0, 32);
}

/** Lazy browser client — avoids SSR/module-init crashes. */
export function getSupabaseClient(): SupabaseClient<Database> {
  if (typeof window === "undefined") {
    const { url, anonKey } = supabaseClientCredentials(getTenantConfig());
    return createBrowserClient<Database>(url, anonKey);
  }
  if (!browserClient) {
    const config = knownConfig();
    if (config) {
      applyConfig(config);
    } else {
      const { url, anonKey } = supabaseClientCredentials(getTenantConfig());
      browserClient = createBrowserClient<Database>(url, anonKey);
    }
  }
  return browserClient!;
}

async function fetchPublicConfig(): Promise<boolean> {
  try {
    const response = await fetch("/api/public-config");
    const payload = (await response.json()) as {
      configured?: boolean;
      issue?: SupabaseConfigIssue;
      urlPreview?: string;
    };
    const config = response.ok ? parsePublicTenantConfig(payload) : null;
    if (config) {
      applyConfig(config);
      return true;
    }
    runtimeIssue = payload.issue ?? "missing";
    runtimeUrlPreview = payload.urlPreview ?? "";
    return false;
  } catch (error) {
    console.error("[supabase] Failed to load runtime public config:", error);
    runtimeIssue = "missing";
    return false;
  }
}

/**
 * Resolves once the browser client points at the tenant's Supabase project.
 * Normally immediate (config embedded in the page); otherwise loads it once
 * from /api/public-config and caches the result for the page's lifetime.
 */
export async function ensureSupabaseReady(): Promise<boolean> {
  if (typeof window === "undefined") return getTenantConfig().isConfigured;
  if (browserConfig) return true;

  const config = knownConfig();
  if (config) {
    applyConfig(config);
    return true;
  }

  loadPromise ??= fetchPublicConfig().then((ok) => {
    if (!ok) loadPromise = null; // allow a retry on the next call
    return ok;
  });
  return loadPromise;
}

/** @deprecated use getSupabaseClient() — kept for existing imports */
export const supabase = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop) {
    const client = getSupabaseClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export function getSupabaseClientInfo() {
  if (browserConfig) {
    return {
      url: browserConfig.url,
      isConfigured: true,
      configIssue: null as SupabaseConfigIssue,
      rawUrlPreview: runtimeUrlPreview,
    };
  }

  const tenant = getTenantConfig();
  return {
    url: supabaseClientCredentials(tenant).url,
    isConfigured: tenant.isConfigured,
    configIssue: runtimeIssue ?? tenant.issue,
    rawUrlPreview: runtimeUrlPreview || tenant.urlPreview,
  };
}

if (typeof window !== "undefined" && !knownConfig()) {
  void ensureSupabaseReady();
}
