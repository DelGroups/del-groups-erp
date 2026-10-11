/**
 * Which modules a tenant has (table tenant_modules). Pure functions shared by
 * the server guard, the proxy, the AI tools and the client hook.
 *
 * Kept free of React/Next imports so `node --test` can load it.
 */
import type { PermissionKey } from "@/types/database.types";
import { buildRouteRules, matchRouteRule, MODULES, moduleClosure, type RouteRule } from "./registry";
import { MODULE_IDS, type ModuleId, type ModuleManifest } from "./types";

export const TENANT_MODULES_TABLE = "tenant_modules";

/** A tenant_modules row as read from the database. */
export interface TenantModuleRow {
  module_id: string;
  enabled: boolean;
  installed_at?: string | null;
  version?: string | null;
}

export type ModuleState =
  /** Enabled in tenant_modules (or no row: modules start enabled). */
  | "enabled"
  /** Disabled in tenant_modules but kept on because an enabled module depends on it. */
  | "required"
  | "disabled";

export function isModuleId(value: string): value is ModuleId {
  return (MODULE_IDS as readonly string[]).includes(value);
}

/**
 * Effective set of enabled modules. `rows === null` means the table does not
 * exist yet: everything is enabled. A module without a row is enabled. Core is
 * always enabled, and every enabled module also enables what it depends on.
 */
export function resolveEnabledModules(
  rows: readonly TenantModuleRow[] | null,
  modules: readonly ModuleManifest[] = MODULES
): Set<ModuleId> {
  const disabled = new Set((rows ?? []).filter((r) => r.enabled === false).map((r) => r.module_id));
  const enabled = new Set<ModuleId>();
  for (const m of modules) {
    if (m.id === "core" || !disabled.has(m.id)) {
      for (const id of moduleClosure(modules, m.id)) {
        if (isModuleId(id)) enabled.add(id);
      }
    }
  }
  return enabled;
}

/** State of every module, for the admin page. */
export function moduleStates(
  rows: readonly TenantModuleRow[] | null,
  modules: readonly ModuleManifest[] = MODULES
): Record<ModuleId, ModuleState> {
  const enabled = resolveEnabledModules(rows, modules);
  const disabledByRow = new Set((rows ?? []).filter((r) => r.enabled === false).map((r) => r.module_id));
  const states = {} as Record<ModuleId, ModuleState>;
  for (const m of modules) {
    states[m.id] = !enabled.has(m.id) ? "disabled" : disabledByRow.has(m.id) ? "required" : "enabled";
  }
  return states;
}

/** Modules to enable together with `id` (itself and its dependencies). */
export function modulesToEnable(id: ModuleId, modules: readonly ModuleManifest[] = MODULES): ModuleId[] {
  return [...moduleClosure(modules, id)].filter(isModuleId);
}

const RULES: readonly RouteRule[] = buildRouteRules(MODULES);

/** Module whose page `pathname` is, or null for pages outside any module. */
export function moduleForPath(pathname: string, rules: readonly RouteRule[] = RULES): ModuleId | null {
  return matchRouteRule(rules, pathname)?.module ?? null;
}

const PERMISSION_OWNER = new Map<string, ModuleId>(
  MODULES.flatMap((m) => m.permissions.map((key) => [key, m.id] as const))
);

/** Module that owns a flat permission key. */
export function moduleForPermission(permission: PermissionKey): ModuleId | null {
  return PERMISSION_OWNER.get(permission) ?? null;
}

const AI_TOOL_OWNER = new Map<string, ModuleId>(
  MODULES.flatMap((m) => m.aiTools.map((tool) => [tool, m.id] as const))
);

/** Module whose data a native AI tool reads. */
export function moduleForAiTool(tool: string): ModuleId | null {
  return AI_TOOL_OWNER.get(tool) ?? null;
}

/** Error code of "not in your plan" API responses. */
export const NOT_IN_PLAN_CODE = "not_in_plan";
export const NOT_IN_PLAN_MESSAGE = "Bu modul planınıza daxil deyil";

/** Thrown by server actions for a module the tenant does not have. */
export class ModuleDisabledError extends Error {
  readonly module: ModuleId;
  constructor(module: ModuleId) {
    super(NOT_IN_PLAN_MESSAGE);
    this.name = "ModuleDisabledError";
    this.module = module;
  }
}

/** First of `ids` that is not enabled, or null when all are (null/undefined ids are skipped). */
export function firstDisabledModule(
  enabled: ReadonlySet<string>,
  ids: readonly (ModuleId | null | undefined)[]
): ModuleId | null {
  for (const id of ids) {
    if (id && !enabled.has(id)) return id;
  }
  return null;
}

/** Body and status of the API "not in your plan" response. */
export function notInPlanBody(id: ModuleId): { status: 403; body: { error: string; module: ModuleId; message: string } } {
  return { status: 403, body: { error: NOT_IN_PLAN_CODE, module: id, message: NOT_IN_PLAN_MESSAGE } };
}
