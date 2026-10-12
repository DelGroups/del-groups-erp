/**
 * Multi-tenant resolution core (prompt 8): which tenant a request's Host belongs to,
 * what its status allows, and how the proxy hands the tenant to the rest of the app.
 *
 * - The control plane (control-panel/, its own Supabase project) maps domains to tenants.
 *   It is looked up server-side with its service key (CONTROL_PLANE_URL /
 *   CONTROL_PLANE_SERVICE_ROLE_KEY) and cached in memory for 60 s; a signed webhook from
 *   the control panel clears the cache.
 * - When those env vars are missing there is no control plane: the app stays
 *   single-tenant and reads the tenant from NEXT_PUBLIC_SUPABASE_* exactly as before.
 * - src/proxy.ts resolves the tenant and passes it on as request headers signed with an
 *   HMAC key derived from the control-plane key, so a client cannot forge them.
 *
 * Server only (node:crypto). Kept free of Next/React imports and `@/` aliases so
 * `node --test` can load it.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { isAllowedTenantApiUrl } from "./config";

export { isAllowedTenantApiUrl };

export const TENANT_STATUSES = [
  "provisioning",
  "trial",
  "active",
  "past_due",
  "read_only",
  "suspended",
  "cancelled",
] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export function isTenantStatus(value: unknown): value is TenantStatus {
  return typeof value === "string" && (TENANT_STATUSES as readonly string[]).includes(value);
}

/** What the control plane returns for a tenant (service key never leaves the server). */
export interface TenantRecord {
  tenantId: string;
  slug: string;
  status: TenantStatus;
  apiUrl: string;
  anonKey: string;
  serviceRoleKey: string;
}

export type EnvLike = Readonly<Record<string, string | undefined>>;

export interface ControlPlaneEnv {
  url: string;
  serviceRoleKey: string;
}

/** The control plane, or null when it is not configured (single-tenant mode). */
export function controlPlaneFromEnv(env: EnvLike): ControlPlaneEnv | null {
  const url = (env.CONTROL_PLANE_URL ?? "").trim().replace(/\/+$/, "");
  const serviceRoleKey = (env.CONTROL_PLANE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey };
}

// ── Host ────────────────────────────────────────────────────────────────────

/** "Acme.Example.AZ:3000" → "acme.example.az"; null for anything that is not a host name. */
export function normalizeHost(value: string | null | undefined): string | null {
  if (!value) return null;
  let host = value.trim().toLowerCase();
  if (host.startsWith("[")) return null; // IPv6 literals are never tenant domains
  host = host.replace(/:\d+$/, "").replace(/\.$/, "");
  if (!host || host.length > 253) return null;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(host)) return null;
  return host;
}

// ── Status rules ────────────────────────────────────────────────────────────

export type TenantAccess =
  | { kind: "allow"; readOnly: boolean }
  | { kind: "read_only_blocked" }
  | { kind: "suspended" }
  | { kind: "preparing" };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * What a tenant's status allows for one request:
 * - trial, active, past_due: everything;
 * - read_only: reading pages (GET/HEAD/OPTIONS); any mutation (POST, server actions,
 *   PUT/PATCH/DELETE) is blocked, and pages show a read-only banner;
 * - suspended, cancelled: the "account suspended" page;
 * - provisioning: the "being prepared" page.
 */
export function tenantAccess(status: TenantStatus, method: string): TenantAccess {
  switch (status) {
    case "trial":
    case "active":
    case "past_due":
      return { kind: "allow", readOnly: false };
    case "read_only":
      return SAFE_METHODS.has(method.toUpperCase()) ? { kind: "allow", readOnly: true } : { kind: "read_only_blocked" };
    case "suspended":
    case "cancelled":
      return { kind: "suspended" };
    case "provisioning":
      return { kind: "preparing" };
  }
}

// ── Signed request headers (proxy → app) ────────────────────────────────────

export const TENANT_HEADER = {
  id: "x-erp-tenant-id",
  slug: "x-erp-tenant-slug",
  status: "x-erp-tenant-status",
  url: "x-erp-tenant-url",
  anonKey: "x-erp-tenant-anon-key",
  signature: "x-erp-tenant-signature",
} as const;

const SIGNED_FIELDS = ["id", "slug", "status", "url", "anonKey"] as const;

/** HMAC key for the tenant headers, derived from the control-plane key (no extra secret). */
export function tenantHeaderKey(controlPlane: ControlPlaneEnv): string {
  return createHmac("sha256", controlPlane.serviceRoleKey).update("erp-tenant-headers/v1").digest("hex");
}

function sign(values: Record<(typeof SIGNED_FIELDS)[number], string>, key: string): string {
  const payload = SIGNED_FIELDS.map((f) => `${f}=${values[f]}`).join("\n");
  return createHmac("sha256", key).update(payload).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Headers the proxy adds for the app. The service key is never one of them. */
export function signedTenantHeaders(record: TenantRecord, key: string): Record<string, string> {
  const values = { id: record.tenantId, slug: record.slug, status: record.status, url: record.apiUrl, anonKey: record.anonKey };
  return {
    [TENANT_HEADER.id]: values.id,
    [TENANT_HEADER.slug]: values.slug,
    [TENANT_HEADER.status]: values.status,
    [TENANT_HEADER.url]: values.url,
    [TENANT_HEADER.anonKey]: values.anonKey,
    [TENANT_HEADER.signature]: sign(values, key),
  };
}

/** Removes every x-erp-tenant-* header a client may have sent. */
export function stripTenantHeaders(headers: Headers): Headers {
  const clean = new Headers(headers);
  for (const name of Object.values(TENANT_HEADER)) clean.delete(name);
  return clean;
}

export interface HeaderTenant {
  tenantId: string;
  slug: string;
  status: TenantStatus;
  apiUrl: string;
  anonKey: string;
}

/** The tenant from proxy headers, or null if any header is missing or the signature is wrong. */
export function verifyTenantHeaders(headers: Pick<Headers, "get">, key: string): HeaderTenant | null {
  const values = {
    id: headers.get(TENANT_HEADER.id) ?? "",
    slug: headers.get(TENANT_HEADER.slug) ?? "",
    status: headers.get(TENANT_HEADER.status) ?? "",
    url: headers.get(TENANT_HEADER.url) ?? "",
    anonKey: headers.get(TENANT_HEADER.anonKey) ?? "",
  };
  const signature = headers.get(TENANT_HEADER.signature) ?? "";
  if (!values.id || !signature || !isTenantStatus(values.status)) return null;
  if (!safeEqual(signature, sign(values, key))) return null;
  return { tenantId: values.id, slug: values.slug, status: values.status, apiUrl: values.url, anonKey: values.anonKey };
}

// ── Webhook from the control panel ──────────────────────────────────────────

export const WEBHOOK_SIGNATURE_HEADER = "x-erp-signature";
const WEBHOOK_MAX_AGE_MS = 5 * 60_000;

export function signWebhookBody(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/**
 * True when `body` carries a valid signature and its `sentAt` (ms since epoch) is within
 * five minutes, so an old request cannot be replayed.
 */
export function verifyWebhook(body: string, signature: string | null, secret: string, now: number): boolean {
  if (!secret || !signature || !safeEqual(signature, signWebhookBody(body, secret))) return false;
  try {
    const sentAt = Number((JSON.parse(body) as { sentAt?: unknown }).sentAt);
    return Number.isFinite(sentAt) && Math.abs(now - sentAt) <= WEBHOOK_MAX_AGE_MS;
  } catch {
    return false;
  }
}

// ── Control-plane lookup with a 60 s cache ──────────────────────────────────

export const TENANT_CACHE_TTL_MS = 60_000;
const LOOKUP_TIMEOUT_MS = 3_000;

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export interface TenantResolver {
  /** The tenant mapped to this host; null for an unknown host. Throws when the control plane fails. */
  byHost(host: string): Promise<TenantRecord | null>;
  /** The tenant with this id (service key for server code); null when unknown. */
  byId(tenantId: string): Promise<TenantRecord | null>;
  /** Forget everything (webhook from the control panel). */
  clear(): void;
}

/** Validates one row of control_plane.erp_tenant_runtime(). */
export function parseTenantRow(row: unknown, production: boolean): TenantRecord | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const record: TenantRecord = {
    tenantId: text(r.tenant_id),
    slug: text(r.slug),
    status: r.status as TenantStatus,
    apiUrl: text(r.api_url).replace(/\/+$/, ""),
    anonKey: text(r.anon_key),
    serviceRoleKey: text(r.service_role_key),
  };
  if (!record.tenantId || !isTenantStatus(record.status)) return null;
  // A tenant still being prepared may not have a database yet; any other needs one.
  if (record.status !== "provisioning" && (!isAllowedTenantApiUrl(record.apiUrl, production) || !record.anonKey)) {
    return null;
  }
  return record;
}

export function createTenantResolver(options: {
  controlPlane: ControlPlaneEnv;
  fetch: Fetch;
  production: boolean;
  now?: () => number;
  ttlMs?: number;
}): TenantResolver {
  const now = options.now ?? Date.now;
  const ttl = options.ttlMs ?? TENANT_CACHE_TTL_MS;
  const cache = new Map<string, { value: TenantRecord | null; expires: number }>();

  async function lookup(args: { p_host?: string; p_tenant_id?: string }): Promise<TenantRecord | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
    try {
      const response = await options.fetch(`${options.controlPlane.url}/rest/v1/rpc/erp_tenant_runtime`, {
        method: "POST",
        headers: {
          apikey: options.controlPlane.serviceRoleKey,
          Authorization: `Bearer ${options.controlPlane.serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_host: args.p_host ?? null, p_tenant_id: args.p_tenant_id ?? null }),
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`control plane lookup failed: HTTP ${response.status}`);
      const rows = (await response.json()) as unknown;
      const row = Array.isArray(rows) ? rows[0] : rows;
      return row ? parseTenantRow(row, options.production) : null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function cached(key: string, load: () => Promise<TenantRecord | null>): Promise<TenantRecord | null> {
    const hit = cache.get(key);
    if (hit && hit.expires > now()) return hit.value;
    const value = await load();
    cache.set(key, { value, expires: now() + ttl });
    if (value) cache.set(`id:${value.tenantId}`, { value, expires: now() + ttl });
    return value;
  }

  return {
    byHost: (host) => cached(`host:${host}`, () => lookup({ p_host: host })),
    byId: (tenantId) => cached(`id:${tenantId}`, () => lookup({ p_tenant_id: tenantId })),
    clear: () => cache.clear(),
  };
}
