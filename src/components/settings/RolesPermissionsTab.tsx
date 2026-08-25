"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Lock,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fetchRoles } from "@/lib/auth/profile";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import {
  PERMISSION_MODULES,
  createPermissionMap,
  normalizePermissions,
  type Json,
  type PermissionKey,
  type PermissionMap,
  type Role,
} from "@/types/database.types";

interface RoleDraft {
  name: string;
  description: string;
  permissions: PermissionMap;
}

function toDraft(role: Role): RoleDraft {
  return {
    name: role.name,
    description: role.description || "",
    permissions: { ...role.permissions },
  };
}

function countGranted(permissions: PermissionMap): number {
  return Object.values(permissions).filter(Boolean).length;
}

export default function RolesPermissionsTab() {
  const { refresh: refreshAuth } = useAuth();
  const { t } = useI18n();
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState<RoleDraft>({
    name: "",
    description: "",
    permissions: createPermissionMap(false),
  });

  const selectedRole = useMemo(
    () => roles.find((role) => role.id === selectedRoleId) ?? null,
    [roles, selectedRoleId]
  );

  const loadRoles = async (selectId?: string) => {
    setLoading(true);
    setError("");
    try {
      const rows = await fetchRoles(supabase);
      setRoles(rows);
      const target = selectId
        ? rows.find((role) => role.id === selectId)
        : rows.find((role) => role.id === selectedRoleId) ?? rows[0];
      if (target) {
        setSelectedRoleId(target.id);
        setDraft(toDraft(target));
        setIsCreating(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.rolesLoadFailed"));
    }
    setLoading(false);
  };

  useEffect(() => {
    void loadRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flash = (message: string) => {
    setSuccessMsg(message);
    setTimeout(() => setSuccessMsg(""), 4000);
  };

  const selectRole = (role: Role) => {
    setSelectedRoleId(role.id);
    setDraft(toDraft(role));
    setIsCreating(false);
    setError("");
  };

  const startCreating = () => {
    setIsCreating(true);
    setSelectedRoleId(null);
    setDraft({ name: "", description: "", permissions: createPermissionMap(false) });
    setError("");
  };

  const togglePermission = (key: PermissionKey) => {
    setDraft((prev) => ({
      ...prev,
      permissions: { ...prev.permissions, [key]: !prev.permissions[key] },
    }));
  };

  const toggleModule = (moduleKeys: PermissionKey[], value: boolean) => {
    setDraft((prev) => {
      const next = { ...prev.permissions };
      for (const key of moduleKeys) next[key] = value;
      return { ...prev, permissions: next };
    });
  };

  const setAll = (value: boolean) => {
    setDraft((prev) => ({ ...prev, permissions: createPermissionMap(value) }));
  };

  const handleSave = async () => {
    const name = draft.name.trim();
    if (!name) {
      setError(t("settings.roleNameRequired"));
      return;
    }

    setSaving(true);
    setError("");
    const permissions = normalizePermissions(draft.permissions);

    if (isCreating) {
      const { data, error: insertError } = await supabase
        .from("roles")
        .insert([
          {
            name,
            description: draft.description.trim() || null,
            permissions: permissions as Json,
          },
        ])
        .select("id")
        .single();

      setSaving(false);
      if (insertError) {
        setError(insertError.message);
        return;
      }
      flash(t("settings.roleCreated", { name }));
      await loadRoles(data?.id as string);
      return;
    }

    if (!selectedRole) {
      setSaving(false);
      return;
    }

    const { error: updateError } = await supabase
      .from("roles")
      .update({
        name,
        description: draft.description.trim() || null,
        permissions: permissions as Json,
      })
      .eq("id", selectedRole.id);

    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    flash(t("settings.rolePermissionsUpdated", { name }));
    await loadRoles(selectedRole.id);
    await refreshAuth();
  };

  const handleDelete = async () => {
    if (!selectedRole || selectedRole.is_system) return;
    if (!confirm(t("settings.deleteRoleConfirm", { name: selectedRole.name }))) {
      return;
    }

    const { error: deleteError } = await supabase
      .from("roles")
      .delete()
      .eq("id", selectedRole.id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    flash(t("settings.roleDeleted", { name: selectedRole.name }));
    setSelectedRoleId(null);
    await loadRoles();
  };

  const editingSystemAdmin = !isCreating && selectedRole?.name === "Admin";

  return (
    <div className="space-y-4 p-6">
      {successMsg && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-bold text-emerald-800">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          {successMsg}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-bold text-rose-800">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
        <div className="app-card space-y-2 p-4">
          <div className="flex items-center justify-between border-b border-app pb-2">
            <h2 className="flex items-center gap-2 text-sm font-bold text-app">
              <ShieldCheck className="h-4 w-4 text-app-accent" />
              {t("settings.rolesHeading")}
            </h2>
            <span className="text-[10px] font-bold text-app-muted">{roles.length}</span>
          </div>

          {loading ? (
            <p className="py-6 text-center text-xs text-app-muted">{t("common.loading")}</p>
          ) : (
            <div className="space-y-1">
              {roles.map((role) => (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => selectRole(role)}
                  className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${
                    role.id === selectedRoleId
                      ? "bg-blue-600 text-white"
                      : "text-app hover:bg-app-card-hover"
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-xs font-semibold">
                    {role.name}
                    {role.is_system && <Lock className="h-3 w-3 opacity-70" />}
                  </span>
                  <span
                    className={`text-[10px] ${
                      role.id === selectedRoleId ? "text-blue-100" : "text-app-muted"
                    }`}
                  >
                    {t("settings.permissionCount", { count: countGranted(role.permissions) })}
                  </span>
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={startCreating}
            className={`flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed py-2 text-[11px] font-bold transition-colors ${
              isCreating
                ? "border-blue-400 bg-[color:var(--app-accent-soft)] text-app-accent"
                : "border-app text-app-muted hover:border-blue-400 hover:text-app-accent"
            }`}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("settings.createRole")}
          </button>
        </div>

        <div className="app-card space-y-4 p-5">
          {!isCreating && !selectedRole ? (
            <p className="py-12 text-center text-xs text-app-muted">
              {t("settings.selectRoleHint")}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 border-b border-app pb-4 md:grid-cols-2">
                <label className="block text-xs font-semibold text-app">
                  {t("settings.roleName")}
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                    disabled={editingSystemAdmin}
                    placeholder={t("settings.roleNamePlaceholder")}
                    className="mt-1 w-full rounded-lg border border-app px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[color:var(--app-accent-ring)] disabled:bg-app-card-hover disabled:text-app-muted"
                  />
                </label>
                <label className="block text-xs font-semibold text-app">
                  {t("settings.roleDescription")}
                  <input
                    type="text"
                    value={draft.description}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, description: e.target.value }))
                    }
                    placeholder={t("settings.roleDescriptionPlaceholder")}
                    className="mt-1 w-full rounded-lg border border-app px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--app-accent-ring)]"
                  />
                </label>
              </div>

              {editingSystemAdmin && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] font-semibold text-amber-800">
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                  {t("settings.adminRoleNotice")}
                </div>
              )}

              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-wide text-app-muted">
                  {t("settings.permissionPoints", { count: countGranted(draft.permissions) })}
                </p>
                <div className="flex gap-2 text-[11px] font-bold">
                  <button
                    type="button"
                    onClick={() => setAll(true)}
                    className="rounded-lg border border-app px-2.5 py-1 text-app-muted hover:bg-app-card-hover"
                  >
                    {t("settings.selectAll")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAll(false)}
                    className="rounded-lg border border-app px-2.5 py-1 text-app-muted hover:bg-app-card-hover"
                  >
                    {t("settings.resetAll")}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {PERMISSION_MODULES.map((module) => {
                  const moduleKeys = module.permissions.map(
                    (perm) => perm.key as PermissionKey
                  );
                  const allChecked = moduleKeys.every((key) => draft.permissions[key]);
                  return (
                    <div
                      key={module.id}
                      className="space-y-2 rounded-xl border border-app bg-app-card-hover p-3"
                    >
                      <div className="flex items-center justify-between border-b border-app pb-1.5">
                        <h3 className="text-[11px] font-bold uppercase tracking-wide text-app">
                          {module.title}
                        </h3>
                        <button
                          type="button"
                          onClick={() => toggleModule(moduleKeys, !allChecked)}
                          className="text-[10px] font-bold text-app-accent hover:underline"
                        >
                          {allChecked ? t("settings.resetModule") : t("settings.selectModule")}
                        </button>
                      </div>
                      {module.permissions.map((perm) => (
                        <label
                          key={perm.key}
                          className="flex cursor-pointer items-start gap-2 text-[11px] font-medium text-app"
                        >
                          <input
                            type="checkbox"
                            checked={!!draft.permissions[perm.key as PermissionKey]}
                            onChange={() => togglePermission(perm.key as PermissionKey)}
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-app text-app-accent focus:ring-[color:var(--app-accent-ring)]"
                          />
                          <span>{perm.label}</span>
                        </label>
                      ))}
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-app pt-4">
                {selectedRole && !selectedRole.is_system && (
                  <button
                    type="button"
                    onClick={() => void handleDelete()}
                    className="mr-auto flex items-center gap-1.5 rounded-xl border border-rose-200 px-4 py-2.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    {t("settings.deleteRole")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
                >
                  <Save className="h-4 w-4" />
                  {saving
                    ? t("common.saving")
                    : isCreating
                      ? t("settings.createRoleBtn")
                      : t("settings.savePermissions")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
