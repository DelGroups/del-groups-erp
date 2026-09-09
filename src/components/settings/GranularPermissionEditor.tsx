"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  GRANULAR_PERMISSION_MODULES,
  type PermissionMatrix,
} from "@/lib/auth/permissionMatrix";
import type { RoleScopes } from "@/types/database.types";

interface LookupOption {
  id: string;
  name: string;
}

interface Props {
  matrix: PermissionMatrix;
  scopes: RoleScopes;
  warehouses: LookupOption[];
  accounts: LookupOption[];
  disabled?: boolean;
  onMatrixChange: (matrix: PermissionMatrix) => void;
  onScopesChange: (scopes: RoleScopes) => void;
}

export default function GranularPermissionEditor({
  matrix,
  scopes,
  warehouses,
  accounts,
  disabled,
  onMatrixChange,
  onScopesChange,
}: Props) {
  const [openModules, setOpenModules] = useState<Record<string, boolean>>({
    production: true,
    finance: true,
    inventory: true,
  });

  const toggleModuleOpen = (moduleId: string) => {
    setOpenModules((prev) => ({ ...prev, [moduleId]: !prev[moduleId] }));
  };

  const togglePermission = (moduleId: string, key: string) => {
    onMatrixChange({
      ...matrix,
      [moduleId]: {
        ...(matrix[moduleId] || {}),
        [key]: !matrix[moduleId]?.[key],
      },
    });
  };

  const toggleScopeId = (
    field: "allowed_warehouses" | "allowed_financial_accounts",
    id: string
  ) => {
    const current = scopes[field];
    const next = current.includes(id) ? current.filter((row) => row !== id) : [...current, id];
    onScopesChange({ ...scopes, [field]: next });
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-app bg-app-card-hover p-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-app-muted">Sərhədlər</p>
        <label className="mt-2 block text-xs font-semibold text-app">
          Qeyd girişi
          <select
            className="input-field mt-1 w-full"
            disabled={disabled}
            value={scopes.record_access}
            onChange={(e) =>
              onScopesChange({
                ...scopes,
                record_access: e.target.value as RoleScopes["record_access"],
              })
            }
          >
            <option value="ALL_RECORDS">Bütün qeydlər</option>
            <option value="OWN_ONLY">Yalnız öz qeydləri</option>
          </select>
        </label>
      </div>

      {GRANULAR_PERMISSION_MODULES.map((module) => {
        const isOpen = openModules[module.id] ?? false;
        const modulePerms = matrix[module.id] || {};
        const granted = module.permissions.filter((perm) => modulePerms[perm.key]).length;

        return (
          <div key={module.id} className="overflow-hidden rounded-xl border border-app">
            <button
              type="button"
              disabled={disabled}
              onClick={() => toggleModuleOpen(module.id)}
              className="flex w-full items-center justify-between bg-app-card-hover px-4 py-3 text-left"
            >
              <span className="flex items-center gap-2 text-sm font-bold text-app">
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 text-app-muted" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-app-muted" />
                )}
                {module.title}
              </span>
              <span className="text-[10px] font-bold text-app-muted">{granted} aktiv</span>
            </button>

            {isOpen ? (
              <div className="space-y-3 border-t border-app p-4">
                <div className="grid gap-2 md:grid-cols-2">
                  {module.permissions.map((perm) => (
                    <label
                      key={`${module.id}.${perm.key}`}
                      className="flex cursor-pointer items-start gap-2 rounded-lg border border-app bg-app-card px-3 py-2 text-xs font-medium text-app"
                    >
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={!!modulePerms[perm.key]}
                        onChange={() => togglePermission(module.id, perm.key)}
                        className="mt-0.5 h-3.5 w-3.5 rounded border-app text-app-accent"
                      />
                      <span>{perm.label}</span>
                    </label>
                  ))}
                </div>

                {module.hasWarehouseScope ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold text-app">İcazəli anbarlar</p>
                    <p className="mb-2 text-[10px] text-app-muted">
                      Boş seçim = bütün anbarlar. Seçilmiş anbarlar məhdudiyyət tətbiq edir.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {warehouses.map((warehouse) => {
                        const selected = scopes.allowed_warehouses.includes(warehouse.id);
                        return (
                          <button
                            key={warehouse.id}
                            type="button"
                            disabled={disabled}
                            onClick={() => toggleScopeId("allowed_warehouses", warehouse.id)}
                            className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                              selected
                                ? "bg-emerald-600 text-white"
                                : "border border-app bg-app-card-hover text-app-muted"
                            }`}
                          >
                            {warehouse.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {module.hasAccountScope ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold text-app">İcazəli kassalar / banklar</p>
                    <p className="mb-2 text-[10px] text-app-muted">
                      Boş seçim = bütün hesablar.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {accounts.map((account) => {
                        const selected = scopes.allowed_financial_accounts.includes(account.id);
                        return (
                          <button
                            key={account.id}
                            type="button"
                            disabled={disabled}
                            onClick={() => toggleScopeId("allowed_financial_accounts", account.id)}
                            className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                              selected
                                ? "bg-amber-600 text-white"
                                : "border border-app bg-app-card-hover text-app-muted"
                            }`}
                          >
                            {account.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
