import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  getPublicSupabaseConfigStatus,
  type SupabaseConfigIssue,
} from "@/lib/env";

let browserClient: SupabaseClient<Database> | null = null;
let runtimeReady = false;
let runtimeIssue: SupabaseConfigIssue = null;
let runtimeUrlPreview = "";

function applyRuntimeConfig(url: string, anonKey: string) {
  browserClient = createBrowserClient<Database>(url, anonKey);
  runtimeReady = true;
  runtimeIssue = null;
  runtimeUrlPreview = url.slice(0, 32);
}

function getBuildTimeStatus() {
  return getPublicSupabaseConfigStatus();
}

function createClientFromStatus() {
  const status = getBuildTimeStatus();
  return createBrowserClient<Database>(status.url, status.anonKey);
}

/** Lazy browser client — avoids SSR/module-init crashes on Vercel. */
export function getSupabaseClient(): SupabaseClient<Database> {
  if (typeof window === "undefined") {
    return createClientFromStatus();
  }
  if (!browserClient) {
    const status = getBuildTimeStatus();
    if (status.isConfigured) {
      applyRuntimeConfig(status.url, status.anonKey);
    } else {
      browserClient = createClientFromStatus();
    }
  }
  return browserClient;
}

/**
 * Loads Supabase public config from /api/public-config when build-time NEXT_PUBLIC_* vars
 * were not inlined into the client bundle (common on Vercel after env changes).
 */
export async function ensureSupabaseReady(): Promise<boolean> {
  const buildStatus = getBuildTimeStatus();
  if (buildStatus.isConfigured) {
    if (typeof window !== "undefined" && !runtimeReady) {
      applyRuntimeConfig(buildStatus.url, buildStatus.anonKey);
    }
    return true;
  }

  if (typeof window === "undefined") {
    return buildStatus.isConfigured;
  }

  if (runtimeReady) return true;

  try {
    const response = await fetch("/api/public-config", { cache: "no-store" });
    const payload = (await response.json()) as {
      configured?: boolean;
      url?: string;
      anonKey?: string;
      issue?: SupabaseConfigIssue;
      urlPreview?: string;
    };

    if (response.ok && payload.configured && payload.url && payload.anonKey) {
      applyRuntimeConfig(payload.url, payload.anonKey);
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

/** @deprecated use getSupabaseClient() — kept for existing imports */
export const supabase = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop) {
    const client = getSupabaseClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export function getSupabaseClientInfo() {
  if (runtimeReady) {
    return {
      url: runtimeUrlPreview || getBuildTimeStatus().url,
      isConfigured: true,
      configIssue: null as SupabaseConfigIssue,
      rawUrlPreview: runtimeUrlPreview,
    };
  }

  const status = getBuildTimeStatus();
  return {
    url: status.url,
    isConfigured: status.isConfigured,
    configIssue: runtimeIssue ?? status.configIssue,
    rawUrlPreview: runtimeUrlPreview || status.rawUrlPreview,
  };
}

if (typeof window !== "undefined" && !getBuildTimeStatus().isConfigured) {
  void ensureSupabaseReady();
}
