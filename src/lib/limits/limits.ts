/**
 * Plan limits of the current tenant (prompt 12): seats, storage and AI. Pure functions shared
 * by server code, API routes and the UI. The numbers come from public.tenant_limit_status()
 * in the tenant database (limits synced from the control panel; usage measured live).
 * A null limit means unlimited, which is the state of every tenant without a subscription.
 *
 * Kept free of Next/React imports and `@/` aliases so `node --test` can load it.
 */

export interface LimitUsage {
  used: number;
  /** null = unlimited */
  limit: number | null;
}

export interface TenantLimitStatus {
  users: LimitUsage;
  /** bytes */
  storage: LimitUsage;
  /** USD this calendar month */
  ai: LimitUsage;
}

export type LimitKind = keyof TenantLimitStatus;
export type LimitState = "unlimited" | "ok" | "warning" | "blocked";

/** Warn from 80 % of a limit; block at 100 %. */
export const WARN_AT = 0.8;

export const LIMIT_ERROR = {
  users: "seat_limit_reached",
  storage: "storage_limit_reached",
  ai: "ai_limit_reached",
} as const satisfies Record<LimitKind, string>;

export const UNLIMITED: TenantLimitStatus = {
  users: { used: 0, limit: null },
  storage: { used: 0, limit: null },
  ai: { used: 0, limit: null },
};

export function limitState(usage: LimitUsage): LimitState {
  if (usage.limit === null) return "unlimited";
  if (usage.limit <= 0 || usage.used >= usage.limit) return "blocked";
  return usage.used >= usage.limit * WARN_AT ? "warning" : "ok";
}

function usage(raw: unknown): LimitUsage {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  const limit = num(r.limit);
  return { used: num(r.used) ?? 0, limit: limit !== null && Number.isFinite(limit) ? limit : null };
}

/** Parses tenant_limit_status() output; anything unreadable counts as unlimited. */
export function parseLimitStatus(raw: unknown): TenantLimitStatus {
  if (!raw || typeof raw !== "object") return UNLIMITED;
  const r = raw as Record<string, unknown>;
  return { users: usage(r.users), storage: usage(r.storage), ai: usage(r.ai) };
}

/** Whether `adding` more active users fit. */
export function seatsAvailable(users: LimitUsage, adding = 1): boolean {
  return users.limit === null || users.used + adding <= users.limit;
}

/** The limit with the worst state, for one banner (blocked before warning). */
export function worstLimit(status: TenantLimitStatus): { kind: LimitKind; state: "warning" | "blocked" } | null {
  let found: { kind: LimitKind; state: "warning" | "blocked" } | null = null;
  for (const kind of ["users", "storage", "ai"] as const) {
    const state = limitState(status[kind]);
    if (state === "blocked") return { kind, state };
    if (state === "warning" && !found) found = { kind, state };
  }
  return found;
}

/** Errors raised by the tenant database's seat trigger. */
export function isSeatLimitDbError(error: { message?: string | null; code?: string | null } | null | undefined): boolean {
  return Boolean(error?.message && /seat_limit_reached/.test(error.message));
}

/** Percentage for progress bars, 0–100. */
export function percentUsed(u: LimitUsage): number {
  if (u.limit === null || u.limit <= 0) return u.limit === 0 ? 100 : 0;
  return Math.min(100, Math.round((u.used / u.limit) * 100));
}

/** "1.5 GB" style sizes for limit messages. */
export function formatBytesShort(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
