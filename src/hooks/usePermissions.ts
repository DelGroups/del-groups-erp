"use client";

import { useMemo } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  filterAccountsByScope,
  filterWarehousesByScope,
  resolveEffectiveAccess,
  resolvePermissionPath,
  type EffectiveAccess,
} from "@/lib/auth/permissionMatrix";
import type { PermissionKey, RecordAccessScope } from "@/types/database.types";

export function usePermissions() {
  const { profile, isAdmin, can } = useAuth();

  const access = useMemo<EffectiveAccess>(
    () => resolveEffectiveAccess(profile, isAdmin),
    [profile, isAdmin]
  );

  return {
    access,
    isAdmin,
    can,
    hasPermission: (path: string) => resolvePermissionPath(access, path),
    getAllowedWarehouses: <T extends { id: string }>(warehouses: T[]) =>
      filterWarehousesByScope(warehouses, access.scopes),
    getAllowedFinancialAccounts: <T extends { id: string }>(accounts: T[]) =>
      filterAccountsByScope(accounts, access.scopes),
    getRecordAccess: (): RecordAccessScope => access.scopes.record_access,
    canViewProductionFinancials: () =>
      isAdmin || resolvePermissionPath(access, "production.view_financials"),
    canApprovePurchaseRequests: () =>
      isAdmin || resolvePermissionPath(access, "production.approve_purchase"),
    hasLegacyPermission: (permission: PermissionKey) => can(permission),
  };
}
