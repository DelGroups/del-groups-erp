"use client";

import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Save, TriangleAlert, UserCog } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fetchAllProfiles } from "@/lib/auth/profile";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import GranularPermissionEditor from "@/components/settings/GranularPermissionEditor";
import {
  countGrantedInMatrix,
  createEmptyMatrix,
  DEFAULT_ROLE_SCOPES,
  mergeScopes,
  parsePermissionOverrides,
  parseStoredPermissions,
  type PermissionMatrix,
} from "@/lib/auth/permissionMatrix";
import {
  fetchRbacLookupsAction,
  updateUserPermissionOverridesAction,
} from "@/lib/actions/rbac";
import type { RoleScopes, UserProfile } from "@/types/database.types";
import { normalizeRoleScopes } from "@/types/database.types";

export default function UserPermissionsTab() {
  const { t } = useI18n();
  const { refresh: refreshAuth } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([]);
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [overrideMatrix, setOverrideMatrix] = useState<PermissionMatrix>({});
  const [overrideScopes, setOverrideScopes] = useState<RoleScopes>(DEFAULT_ROLE_SCOPES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) ?? null,
    [users, selectedUserId]
  );

  const roleMatrix = useMemo(() => {
    if (!selectedUser?.role) return createEmptyMatrix();
    return parseStoredPermissions(selectedUser.role.permissions).matrix;
  }, [selectedUser]);

  const roleScopes = useMemo(
    () => selectedUser?.role?.scopes || DEFAULT_ROLE_SCOPES,
    [selectedUser]
  );

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [profiles, lookups] = await Promise.all([
        fetchAllProfiles(supabase),
        fetchRbacLookupsAction(),
      ]);
      setUsers(profiles);
      if (lookups.success && lookups.data) {
        setWarehouses(lookups.data.warehouses);
        setAccounts(lookups.data.accounts);
      }
      if (!selectedUserId && profiles[0]) {
        selectUser(profiles[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    }
    setLoading(false);
  };

  const selectUser = (user: UserProfile) => {
    setSelectedUserId(user.id);
    const overrides = parsePermissionOverrides(user.permission_overrides);
    setOverrideMatrix(Object.keys(overrides).length ? overrides : {});
    setOverrideScopes(normalizeRoleScopes(user.scope_overrides) || DEFAULT_ROLE_SCOPES);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    if (!selectedUser) return;
    setSaving(true);
    setError("");
    const result = await updateUserPermissionOverridesAction({
      userId: selectedUser.id,
      permissionOverrides: overrideMatrix,
      scopeOverrides: overrideScopes,
    });
    setSaving(false);
    if (!result.success) {
      setError(result.error || t("common.error"));
      return;
    }
    setSuccessMsg(t("settings.userPermissionsSaved"));
    setTimeout(() => setSuccessMsg(""), 4000);
    await load();
    await refreshAuth();
  };

  const effectiveMatrix = useMemo(() => {
    const merged = { ...roleMatrix };
    for (const [moduleId, perms] of Object.entries(overrideMatrix)) {
      merged[moduleId] = { ...(merged[moduleId] || {}), ...perms };
    }
    return merged;
  }, [roleMatrix, overrideMatrix]);

  const effectiveScopes = useMemo(
    () => mergeScopes(roleScopes, overrideScopes),
    [roleScopes, overrideScopes]
  );

  if (loading) {
    return <div className="p-8 text-center text-sm text-app-muted">{t("common.loading")}</div>;
  }

  return (
    <div className="space-y-4 p-6">
      {successMsg ? (
        <div className="flex items-center gap-2 rounded-xl alert-success p-4 text-xs font-bold">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          {successMsg}
        </div>
      ) : null}
      {error ? (
        <div className="flex items-start gap-2 rounded-xl alert-danger p-4 text-xs font-bold">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
        <div className="app-card space-y-2 p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-app">
            <UserCog className="h-4 w-4 text-app-accent" />
            {t("settings.userPermissionsHeading")}
          </h2>
          <div className="space-y-1">
            {users.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => selectUser(user)}
                className={`w-full rounded-lg px-3 py-2 text-left ${
                  user.id === selectedUserId
                    ? "bg-[image:var(--app-gradient)] text-white"
                    : "hover:bg-app-card-hover"
                }`}
              >
                <p className="text-xs font-semibold">{user.full_name || user.email}</p>
                <p className="text-[10px] opacity-80">{user.role?.name || "—"}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="app-card space-y-4 p-5">
          {!selectedUser ? (
            <p className="py-12 text-center text-xs text-app-muted">{t("settings.selectUserHint")}</p>
          ) : (
            <>
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                {t("settings.userPermissionsInherit", { role: selectedUser.role?.name || "—" })}
              </div>

              <GranularPermissionEditor
                matrix={effectiveMatrix}
                scopes={effectiveScopes}
                warehouses={warehouses}
                accounts={accounts}
                onMatrixChange={(matrix) => {
                  const overrides: PermissionMatrix = {};
                  for (const module of Object.keys(matrix)) {
                    const moduleOverrides: Record<string, boolean> = {};
                    for (const [key, value] of Object.entries(matrix[module] || {})) {
                      const roleValue = roleMatrix[module]?.[key];
                      if (value !== roleValue) moduleOverrides[key] = value;
                    }
                    if (Object.keys(moduleOverrides).length) overrides[module] = moduleOverrides;
                  }
                  setOverrideMatrix(overrides);
                }}
                onScopesChange={setOverrideScopes}
              />

              <div className="flex justify-end border-t border-app pt-4">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="btn-primary text-xs"
                >
                  <Save className="h-4 w-4" />
                  {saving ? t("common.saving") : t("settings.saveUserPermissions")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
