/**
 * Module registry: every module manifest, checked and turned into the menu,
 * page access rules and the role permission matrix.
 *
 * Kept free of React/Next imports so `node --test` and the build check
 * (scripts/check-modules.mjs) can load it.
 */
import type { PermissionKey } from "@/types/database.types";
import { NAV_SECTION_DEFS, PERMISSION_GROUP_DEFS } from "./shell";
import {
  MODULE_IDS,
  type FeatureFlag,
  type ModuleId,
  type ModuleManifest,
  type NavSectionId,
} from "./types";
import core from "./core/manifest";
import sales from "./sales/manifest";
import purchases from "./purchases/manifest";
import inventory from "./inventory/manifest";
import polywood from "./polywood/manifest";
import production from "./production/manifest";
import accounting from "./accounting/manifest";
import expenses from "./expenses/manifest";
import hr from "./hr/manifest";
import payroll from "./payroll/manifest";
import crm from "./crm/manifest";
import contracts from "./contracts/manifest";
import consignment from "./consignment/manifest";
import commissions from "./commissions/manifest";
import taxAz from "./tax-az/manifest";
import barcode from "./barcode/manifest";
import ai from "./ai/manifest";
import studio from "./studio/manifest";
import todo from "./todo/manifest";

export { defineModule } from "./types";
export type { ModuleId, ModuleManifest } from "./types";

export const MODULES: readonly ModuleManifest[] = [
  core,
  sales,
  purchases,
  inventory,
  polywood,
  production,
  accounting,
  expenses,
  hr,
  payroll,
  crm,
  contracts,
  consignment,
  commissions,
  taxAz,
  barcode,
  ai,
  studio,
  todo,
];

// ── Validation ──────────────────────────────────────────────────────────────

function findCycle(modules: readonly ModuleManifest[]): string[] | null {
  const byId = new Map<string, ModuleManifest>(modules.map((m) => [m.id, m]));
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === "done") return null;
    if (state.get(id) === "visiting") return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, "visiting");
    stack.push(id);
    for (const dep of byId.get(id)?.depends ?? []) {
      if (!byId.has(dep)) continue;
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, "done");
    return null;
  };
  for (const m of modules) {
    const cycle = visit(m.id);
    if (cycle) return cycle;
  }
  return null;
}

/** The module and everything it depends on, directly or not. */
export function moduleClosure(modules: readonly ModuleManifest[], id: string): Set<string> {
  const byId = new Map<string, ModuleManifest>(modules.map((m) => [m.id, m]));
  const seen = new Set<string>();
  const walk = (current: string) => {
    if (seen.has(current)) return;
    seen.add(current);
    for (const dep of byId.get(current)?.depends ?? []) walk(dep);
  };
  walk(id);
  return seen;
}

/**
 * Every problem in the registry, as readable messages; empty when valid.
 * Pass `allPermissionKeys` to also check that each permission has exactly one owner.
 */
export function validateRegistry(
  modules: readonly ModuleManifest[],
  allPermissionKeys?: readonly string[]
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const m of modules) {
    if (ids.has(m.id)) errors.push(`duplicate module id "${m.id}"`);
    ids.add(m.id);
    if (!/^\d+\.\d+\.\d+$/.test(m.version)) errors.push(`${m.id}: version "${m.version}" is not x.y.z`);
  }
  for (const id of MODULE_IDS) {
    if (!ids.has(id)) errors.push(`module "${id}" has no manifest in the registry`);
  }

  for (const m of modules) {
    for (const dep of m.depends) {
      if (dep === m.id) errors.push(`${m.id}: depends on itself`);
      else if (!ids.has(dep)) errors.push(`${m.id}: unknown dependency "${dep}"`);
    }
    if (m.id !== "core" && !m.depends.includes("core")) errors.push(`${m.id}: must depend on "core"`);
    if (m.id === "core" && m.depends.length) errors.push(`core: must not depend on other modules`);
  }
  const cycle = findCycle(modules);
  if (cycle) errors.push(`dependency cycle: ${cycle.join(" → ")}`);

  // Permission ownership
  const owner = new Map<string, string>();
  for (const m of modules) {
    for (const key of m.permissions) {
      const previous = owner.get(key);
      if (previous) errors.push(`permission "${key}" is owned by both "${previous}" and "${m.id}"`);
      else owner.set(key, m.id);
    }
  }
  if (allPermissionKeys) {
    const known = new Set(allPermissionKeys);
    for (const key of allPermissionKeys) {
      if (!owner.has(key)) errors.push(`permission "${key}" is not owned by any module`);
    }
    for (const key of owner.keys()) {
      if (!known.has(key)) errors.push(`permission "${key}" (owned by "${owner.get(key)}") does not exist`);
    }
  }

  // A module may only use permissions of itself, its dependencies, or modules it
  // borrows from (which must depend on it, so they are never on without it).
  if (!cycle) {
    for (const m of modules) {
      const reachable = moduleClosure(modules, m.id);
      for (const lender of m.borrowsPermissionsFrom ?? []) {
        if (!ids.has(lender)) errors.push(`${m.id}: borrowsPermissionsFrom unknown module "${lender}"`);
        else if (!moduleClosure(modules, lender).has(m.id)) {
          errors.push(`${m.id}: borrows permissions from "${lender}", but "${lender}" does not depend on "${m.id}"`);
        }
        reachable.add(lender);
      }
      const check = (key: string, where: string) => {
        const by = owner.get(key);
        if (by && !reachable.has(by)) {
          errors.push(`${m.id}: ${where} uses "${key}" of module "${by}", which it does not depend on`);
        }
      };
      for (const r of m.routes) check(r.permission, `route ${r.prefix}`);
      for (const p of m.matrix) check(p.legacyKey, `matrix ${p.group}.${p.key}`);
    }
  }

  // Uniqueness and known targets
  const sections = new Set(NAV_SECTION_DEFS.map((s) => s.id));
  const groups = new Set(PERMISSION_GROUP_DEFS.map((g) => g.id));
  const seen = (label: string) => {
    const map = new Map<string, string>();
    return (key: string, moduleId: string) => {
      const previous = map.get(key);
      if (previous) errors.push(`duplicate ${label} "${key}" in "${previous}" and "${moduleId}"`);
      else map.set(key, moduleId);
    };
  };
  const menuPath = seen("menu path");
  const menuOrder = seen("menu order");
  const routeKey = seen("route");
  const matrixKey = seen("matrix permission");
  const matrixOrder = seen("matrix order");
  const aiTool = seen("AI tool");
  const settingKey = seen("setting");
  for (const m of modules) {
    for (const item of m.menus) {
      if (!sections.has(item.section)) errors.push(`${m.id}: menu ${item.path} has unknown section "${item.section}"`);
      menuPath(item.path, m.id);
      menuOrder(`${item.section}#${item.order}`, m.id);
    }
    for (const r of m.routes) routeKey(`${r.prefix}${r.exact ? " (exact)" : ""}`, m.id);
    for (const p of m.matrix) {
      if (!groups.has(p.group)) errors.push(`${m.id}: matrix ${p.key} has unknown group "${p.group}"`);
      matrixKey(`${p.group}.${p.key}`, m.id);
      matrixOrder(`${p.group}#${p.order}`, m.id);
    }
    for (const tool of m.aiTools) aiTool(tool, m.id);
    for (const s of m.settings) settingKey(s.key, m.id);
  }

  // Every linked page needs an access rule.
  const rules = buildRouteRules(modules);
  for (const m of modules) {
    for (const path of [...m.menus.map((i) => i.path), ...(m.links ?? [])]) {
      if (!resolveRoutePermission(rules, path)) errors.push(`${m.id}: ${path} has no route permission`);
    }
  }
  return errors;
}

export function assertValidRegistry(
  modules: readonly ModuleManifest[] = MODULES,
  allPermissionKeys?: readonly string[]
): void {
  const errors = validateRegistry(modules, allPermissionKeys);
  if (errors.length) {
    throw new Error(`Invalid module registry:\n  - ${errors.join("\n  - ")}`);
  }
}

// ── Generated structures ────────────────────────────────────────────────────

export interface RouteRule {
  prefix: string;
  permission: PermissionKey;
  exact?: boolean;
  /** Module that declared the rule. */
  module: ModuleId;
}

/** Page access rules, most specific (longest) prefix first. */
export function buildRouteRules(modules: readonly ModuleManifest[]): RouteRule[] {
  return modules
    .flatMap((m) => m.routes.map((r) => ({ ...r, module: m.id })))
    .sort((a, b) => b.prefix.length - a.prefix.length || a.prefix.localeCompare(b.prefix));
}

/** The rule that decides access to `pathname`, or null when no rule applies. */
export function matchRouteRule(rules: readonly RouteRule[], pathname: string): RouteRule | null {
  for (const rule of rules) {
    if (rule.exact) {
      if (pathname === rule.prefix) return rule;
      continue;
    }
    if (pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`)) return rule;
  }
  return null;
}

export function resolveRoutePermission(rules: readonly RouteRule[], pathname: string): PermissionKey | null {
  return matchRouteRule(rules, pathname)?.permission ?? null;
}

/** Menu and linked paths → the permission needed to see the link. */
export function buildNavPathPermissions(
  modules: readonly ModuleManifest[],
  rules: readonly RouteRule[] = buildRouteRules(modules)
): Record<string, PermissionKey> {
  const result: Record<string, PermissionKey> = {};
  for (const m of modules) {
    for (const path of [...m.menus.map((i) => i.path), ...(m.links ?? [])]) {
      const permission = resolveRoutePermission(rules, path);
      if (permission) result[path] = permission;
    }
  }
  return result;
}

export interface NavItemData {
  titleKey: string;
  path: string;
  icon: string;
  keywords?: string[];
  module: ModuleId;
}

export interface NavSectionData {
  id: NavSectionId;
  titleKey: string;
  icon: string;
  items: NavItemData[];
}

/** Sidebar sections with their items, in display order; icons are lucide names. */
export function buildNavSections(
  modules: readonly ModuleManifest[],
  isFlagEnabled: (flag: FeatureFlag) => boolean = () => true
): NavSectionData[] {
  return NAV_SECTION_DEFS.map((section) => {
    const items = modules
      .flatMap((m) => m.menus.map((item) => ({ item, module: m.id })))
      .filter(({ item }) => item.section === section.id && (!item.flag || isFlagEnabled(item.flag)))
      .sort((a, b) => a.item.order - b.item.order)
      .map(({ item, module }) => ({
        titleKey: item.label,
        path: item.path,
        icon: item.icon,
        ...(item.keywords ? { keywords: item.keywords } : {}),
        module,
      }));
    return { id: section.id, titleKey: section.titleKey, icon: section.icon, items };
  }).filter((section) => section.items.length > 0);
}

export interface PermissionMatrixGroup {
  id: string;
  title: string;
  permissions: { key: string; label: string; legacyKey: PermissionKey }[];
  hasWarehouseScope?: boolean;
  hasAccountScope?: boolean;
}

/** Role permission matrix groups with their checkboxes, in display order. */
export function buildPermissionMatrix(modules: readonly ModuleManifest[]): PermissionMatrixGroup[] {
  return PERMISSION_GROUP_DEFS.map((group) => ({
    id: group.id,
    title: group.title,
    ...(group.hasWarehouseScope ? { hasWarehouseScope: true } : {}),
    ...(group.hasAccountScope ? { hasAccountScope: true } : {}),
    permissions: modules
      .flatMap((m) => m.matrix)
      .filter((p) => p.group === group.id)
      .sort((a, b) => a.order - b.order)
      .map((p) => ({ key: p.key, label: p.label, legacyKey: p.legacyKey })),
  })).filter((group) => group.permissions.length > 0);
}

// Fail fast wherever the registry is loaded (app and build); the full
// permission-ownership check runs in scripts/check-modules.mjs and the tests.
assertValidRegistry(MODULES);
