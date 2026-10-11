"use client";

import React, { createContext, useContext, useMemo } from "react";
import { MODULE_IDS, type ModuleId } from "@/modules/types";

const EnabledModulesContext = createContext<readonly ModuleId[]>(MODULE_IDS);

/** Provides the tenant's enabled modules, read on the server for this request. */
export function EnabledModulesProvider({
  value,
  children,
}: {
  value: readonly ModuleId[];
  children: React.ReactNode;
}) {
  return <EnabledModulesContext.Provider value={value}>{children}</EnabledModulesContext.Provider>;
}

export interface EnabledModules {
  enabled: ReadonlySet<ModuleId>;
  isEnabled: (id: ModuleId | null | undefined) => boolean;
}

/** Modules the tenant has. Outside a provider (tests, storybook) every module is enabled. */
export function useEnabledModules(): EnabledModules {
  const ids = useContext(EnabledModulesContext);
  return useMemo(() => {
    const enabled = new Set(ids);
    return { enabled, isEnabled: (id) => !id || enabled.has(id) };
  }, [ids]);
}
