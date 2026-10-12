/**
 * Supabase Management API (https://api.supabase.com/v1), only what provisioning needs.
 * The token is sent in the Authorization header and nowhere else: errors carry the HTTP
 * status and a sanitised response text, never request headers.
 */

export const MANAGEMENT_API_URL = "https://api.supabase.com";

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export class ManagementApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ManagementApiError";
    this.status = status;
  }
}

/** Removes anything that looks like a token or key from text meant for logs. */
export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 8) out = out.split(s).join("[redacted]");
  return out
    .replace(/\bsbp_[A-Za-z0-9]+/g, "[redacted]")
    .replace(/\bsb_(secret|publishable)_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]")
    .slice(0, 1000);
}

export interface ProjectInfo {
  ref: string;
  name: string;
  region: string;
  status: string;
}

export interface ServiceHealth {
  name: string;
  status: string;
  healthy: boolean;
}

export interface TenantKeys {
  /** Browser key: publishable if the project has one, else the legacy anon key. */
  anonKey: string;
  /** Server key: secret if the project has one, else the legacy service_role key. */
  serviceRoleKey: string;
  kind: "publishable/secret" | "legacy";
}

export interface ManagementApi {
  listProjects(): Promise<ProjectInfo[]>;
  createProject(input: { name: string; organizationSlug: string; dbPass: string; regionGroup: string }): Promise<ProjectInfo>;
  getHealth(ref: string, services: readonly string[]): Promise<ServiceHealth[]>;
  getKeys(ref: string): Promise<TenantKeys>;
  applyMigration(ref: string, name: string, query: string): Promise<void>;
  runQuery<T = Record<string, unknown>>(ref: string, query: string): Promise<T[]>;
  updateAuthConfig(ref: string, config: Record<string, unknown>): Promise<void>;
}

function project(raw: Record<string, unknown>): ProjectInfo {
  return {
    ref: String(raw.ref ?? raw.id ?? ""),
    name: String(raw.name ?? ""),
    region: String(raw.region ?? ""),
    status: String(raw.status ?? ""),
  };
}

/** Picks the tenant's keys from GET /v1/projects/{ref}/api-keys?reveal=true. */
export function pickKeys(raw: unknown): TenantKeys {
  const keys = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  const value = (k: Record<string, unknown> | undefined) => (typeof k?.api_key === "string" ? k.api_key : "");
  const publishable = keys.find((k) => k.type === "publishable");
  const secret = keys.find((k) => k.type === "secret");
  if (value(publishable) && value(secret)) {
    return { anonKey: value(publishable), serviceRoleKey: value(secret), kind: "publishable/secret" };
  }
  const anon = keys.find((k) => k.name === "anon");
  const service = keys.find((k) => k.name === "service_role");
  if (value(anon) && value(service)) {
    return { anonKey: value(anon), serviceRoleKey: value(service), kind: "legacy" };
  }
  throw new ManagementApiError("the project has no usable API keys yet", 0);
}

export function createManagementApi(options: { token: string; fetch: Fetch; baseUrl?: string }): ManagementApi {
  const base = (options.baseUrl ?? MANAGEMENT_API_URL).replace(/\/+$/, "");

  async function call<T>(method: string, pathname: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await options.fetch(`${base}${pathname}`, {
        method,
        headers: {
          Authorization: `Bearer ${options.token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
        cache: "no-store",
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ManagementApiError(`${method} ${pathname}: ${redactSecrets(reason, [options.token])}`, 0);
    }
    const text = await response.text();
    if (!response.ok) {
      throw new ManagementApiError(
        `${method} ${pathname}: HTTP ${response.status} ${redactSecrets(text, [options.token])}`.trim(),
        response.status
      );
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  return {
    async listProjects() {
      const rows = await call<Record<string, unknown>[]>("GET", "/v1/projects");
      return (rows ?? []).map(project);
    },
    async createProject(input) {
      const raw = await call<Record<string, unknown>>("POST", "/v1/projects", {
        name: input.name,
        organization_slug: input.organizationSlug,
        db_pass: input.dbPass,
        region_selection: { type: "smartGroup", code: input.regionGroup },
      });
      return project(raw);
    },
    async getHealth(ref, services) {
      const query = services.map((s) => `services=${encodeURIComponent(s)}`).join("&");
      const rows = await call<Record<string, unknown>[]>("GET", `/v1/projects/${encodeURIComponent(ref)}/health?${query}`);
      return (rows ?? []).map((r) => ({
        name: String(r.name ?? ""),
        status: String(r.status ?? ""),
        healthy: r.healthy === true || r.status === "ACTIVE_HEALTHY",
      }));
    },
    async getKeys(ref) {
      return pickKeys(await call<unknown>("GET", `/v1/projects/${encodeURIComponent(ref)}/api-keys?reveal=true`));
    },
    async applyMigration(ref, name, query) {
      await call("POST", `/v1/projects/${encodeURIComponent(ref)}/database/migrations`, { name, query });
    },
    async runQuery<T>(ref: string, query: string) {
      const rows = await call<T[]>("POST", `/v1/projects/${encodeURIComponent(ref)}/database/query`, { query });
      return Array.isArray(rows) ? rows : [];
    },
    async updateAuthConfig(ref, config) {
      await call("PATCH", `/v1/projects/${encodeURIComponent(ref)}/config/auth`, config);
    },
  };
}
