"use server";

import { requirePermissionAction, ActionAuthError } from "@/lib/auth/serverActionAuth";
import { catchActionError, type ActionResult } from "@/lib/supabase/actionResult";
import { isAdminRole } from "@/types/database.types";
import { getTenantModuleRows } from "@/lib/modules/server";
import { moduleStates, type ModuleState } from "@/modules/enabled";
import { MODULES } from "@/modules/registry";
import type { ModuleId } from "@/modules/types";

export interface ModuleOverviewRow {
  id: ModuleId;
  version: string;
  depends: ModuleId[];
  state: ModuleState;
  /** Modules that are enabled and need this one. */
  requiredBy: ModuleId[];
  installedAt: string | null;
}

export interface ModuleOverview {
  /** False until the tenant_modules migration has run (then every module is enabled). */
  tableExists: boolean;
  modules: ModuleOverviewRow[];
}

/** Read-only list of modules and their state for Settings → Modules (admins only). */
export async function getModuleOverviewAction(): Promise<ActionResult<ModuleOverview>> {
  try {
    const { profile } = await requirePermissionAction("can_manage_settings");
    if (!isAdminRole(profile?.role)) throw new ActionAuthError("İcazəniz yoxdur");

    const rows = await getTenantModuleRows();
    const states = moduleStates(rows);
    const byId = new Map((rows ?? []).map((row) => [row.module_id, row]));
    const modules = MODULES.map((m) => ({
      id: m.id,
      version: byId.get(m.id)?.version || m.version,
      depends: m.depends,
      state: states[m.id],
      requiredBy: MODULES.filter((other) => other.depends.includes(m.id) && states[other.id] !== "disabled").map(
        (other) => other.id
      ),
      installedAt: byId.get(m.id)?.installed_at ?? null,
    }));
    return { success: true, data: { tableExists: rows !== null, modules } };
  } catch (err) {
    return catchActionError(err, "Modullar yüklənmədi") as ActionResult<ModuleOverview>;
  }
}
