"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Mail,
  Pencil,
  Search,
  ShieldCheck,
  TriangleAlert,
  UserPlus,
  Users as UsersIcon,
  X,
} from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import PermissionGuard from "@/components/auth/PermissionGuard";
import SettingsTabs from "@/components/settings/SettingsTabs";
import { useAuth } from "@/components/auth/AuthProvider";
import { supabase } from "@/lib/supabase";
import { fetchAllProfiles, fetchRoles } from "@/lib/auth/profile";
import type { Role, UserProfile } from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("az-AZ");
}

function InviteUserModal({
  roles,
  onClose,
  onInvited,
}: {
  roles: Role[];
  onClose: () => void;
  onInvited: (message: string) => void;
}) {
  const { t } = useI18n();
  const defaultRoleId = useMemo(
    () => roles.find((role) => role.name === "User")?.id || roles[0]?.id || "",
    [roles]
  );

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [roleId, setRoleId] = useState(defaultRoleId);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    const response = await fetch("/api/users/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, full_name: fullName, role_id: roleId }),
    });
    const payload = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(payload.error || t("users.inviteFailed"));
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    onInvited(`${t("users.inviteSent", { email })}`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="app-modal my-10 w-full max-w-md space-y-4 p-6"
      >
        <div className="flex items-start justify-between border-b border-app pb-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-app">
              <UserPlus className="h-4 w-4 text-app-accent" />
              {t("users.inviteModalTitle")}
            </h2>
            <p className="mt-0.5 text-[11px] text-app-muted">
              {t("users.inviteModalDescription")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-app-muted hover:bg-app-card-hover hover:text-app"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-[11px] font-semibold text-rose-800">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            {error}
          </div>
        )}

        <label className="block text-xs font-semibold text-app">
          {t("auth.email")} *
          <div className="relative mt-1">
            <Mail className="absolute left-3 top-2.5 h-4 w-4 text-app-muted" />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ad@delgroups.az"
              className="w-full rounded-lg border border-app py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--app-accent-ring)]"
            />
          </div>
        </label>

        <label className="block text-xs font-semibold text-app">
          {t("auth.fullName")} *
          <input
            type="text"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder={t("users.fullNamePlaceholder")}
            className="mt-1 w-full rounded-lg border border-app px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--app-accent-ring)]"
          />
        </label>

        <label className="block text-xs font-semibold text-app">
          {t("users.roleCol")} *
          <select
            required
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-app app-input text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[color:var(--app-accent-ring)]"
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </label>

        <div className="flex justify-end gap-2 border-t border-app pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-app px-4 py-2.5 text-xs font-semibold text-app-muted hover:bg-app-card-hover"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={submitting || !roleId}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            <UserPlus className="h-4 w-4" />
            {submitting ? t("auth.sending") : t("users.sendInvite")}
          </button>
        </div>
      </form>
    </div>
  );
}

function EditUserModal({
  profile,
  roles,
  currentUserId,
  onClose,
  onSaved,
}: {
  profile: UserProfile;
  roles: Role[];
  currentUserId?: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t } = useI18n();
  const [fullName, setFullName] = useState(profile.full_name ?? "");
  const [email, setEmail] = useState(profile.email ?? "");
  const [roleId, setRoleId] = useState(profile.role_id ?? "");
  const [locale, setLocale] = useState(profile.locale ?? "az");
  const [isActive, setIsActive] = useState(profile.is_active);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const isSelf = profile.id === currentUserId;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    const response = await fetch(`/api/users/${profile.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        full_name: fullName,
        email,
        role_id: roleId,
        locale,
        is_active: isActive,
      }),
    });
    const payload = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(payload.error || t("users.updateFailed"));
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    onSaved(t("users.updated", { name: fullName.trim() || email.trim() }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="app-modal my-10 w-full max-w-md space-y-4 p-6"
      >
        <div className="flex items-start justify-between border-b border-app pb-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-app">
              <Pencil className="h-4 w-4 text-app-accent" />
              {t("users.editModalTitle")}
            </h2>
            <p className="mt-0.5 text-[11px] text-app-muted">
              {t("users.editModalDescription")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-app-muted hover:bg-app-card-hover hover:text-app"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-[11px] font-semibold text-rose-800">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            {error}
          </div>
        )}

        <label className="block text-xs font-semibold text-app">
          {t("auth.fullName")} *
          <input
            type="text"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder={t("users.fullNamePlaceholder")}
            className="mt-1 w-full rounded-lg border border-app px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--app-accent-ring)]"
          />
        </label>

        <label className="block text-xs font-semibold text-app">
          {t("auth.email")} *
          <div className="relative mt-1">
            <Mail className="absolute left-3 top-2.5 h-4 w-4 text-app-muted" />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ad@delgroups.az"
              className="w-full rounded-lg border border-app py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--app-accent-ring)]"
            />
          </div>
        </label>

        <label className="block text-xs font-semibold text-app">
          {t("users.roleCol")} *
          <select
            required
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-app app-input text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[color:var(--app-accent-ring)]"
          >
            <option value="">{t("common.noRole")}</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs font-semibold text-app">
          {t("nav.language")}
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            className="mt-1 w-full rounded-lg border border-app app-input text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[color:var(--app-accent-ring)]"
          >
            <option value="az">{t("users.localeAz")}</option>
            <option value="en">{t("users.localeEn")}</option>
            <option value="ru">{t("users.localeRu")}</option>
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs font-semibold text-app">
          <input
            type="checkbox"
            checked={isActive}
            disabled={isSelf}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 rounded border-app text-app-accent focus:ring-[color:var(--app-accent-ring)] disabled:opacity-50"
          />
          {t("common.active")}
          {isSelf && (
            <span className="text-[10px] font-normal text-app-muted">
              ({t("common.cannotDeactivateSelf")})
            </span>
          )}
        </label>

        <div className="flex justify-end gap-2 border-t border-app pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-app px-4 py-2.5 text-xs font-semibold text-app-muted hover:bg-app-card-hover"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={submitting || !roleId}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            <CheckCircle2 className="h-4 w-4" />
            {submitting ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </form>
    </div>
  );
}

function UsersView() {
  const { t } = useI18n();
  const { user: currentUser, refresh: refreshAuth } = useAuth();
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [editingProfile, setEditingProfile] = useState<UserProfile | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const [profileRows, roleRows] = await Promise.all([
        fetchAllProfiles(supabase),
        fetchRoles(supabase),
      ]);
      setProfiles(profileRows);
      setRoles(roleRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.dataLoadFailed"));
    }
    setLoading(false);
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flash = (message: string) => {
    setSuccessMsg(message);
    setTimeout(() => setSuccessMsg(""), 4000);
  };

  const handleRoleChange = async (profileId: string, roleId: string) => {
    setError("");
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ role_id: roleId, updated_at: new Date().toISOString() })
      .eq("id", profileId);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    flash(t("users.roleUpdated"));
    await loadData();
    if (profileId === currentUser?.id) await refreshAuth();
  };

  const handleToggleActive = async (profile: UserProfile) => {
    setError("");
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ is_active: !profile.is_active, updated_at: new Date().toISOString() })
      .eq("id", profile.id);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    flash(
      profile.is_active
        ? t("users.deactivated", { name: profile.full_name || profile.email || "" })
        : t("users.activated", { name: profile.full_name || profile.email || "" })
    );
    await loadData();
  };

  const filteredProfiles = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return profiles;
    return profiles.filter((profile) =>
      [profile.full_name, profile.email, profile.role?.name]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(term))
    );
  }, [profiles, searchTerm]);

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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-app-muted" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t("users.searchPlaceholder")}
            className="w-full rounded-xl border border-app py-2 pl-9 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-[color:var(--app-accent-ring)]"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowInvite(true)}
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
        >
          <UserPlus className="h-4 w-4" />
          {t("users.inviteUser")}
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl app-card">
        <table className="w-full text-left text-xs">
          <thead className="bg-app-card-hover text-[10px] font-bold uppercase tracking-wide text-app-muted">
            <tr>
              <th className="px-6 py-3">{t("users.userCol")}</th>
              <th className="px-6 py-3">{t("users.emailCol")}</th>
              <th className="px-6 py-3">{t("users.roleCol")}</th>
              <th className="px-6 py-3">{t("common.status")}</th>
              <th className="px-6 py-3">{t("common.createdAt")}</th>
              <th className="px-6 py-3 text-right">{t("common.action")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-app-muted">
                  {t("common.loading")}
                </td>
              </tr>
            ) : filteredProfiles.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-app-muted">
                  {t("users.empty")}
                </td>
              </tr>
            ) : (
              filteredProfiles.map((profile) => (
                <tr key={profile.id} className="hover:bg-app-card-hover">
                  <td className="px-6 py-3.5 font-semibold text-app">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{profile.full_name || t("common.anonymous")}</span>
                      {profile.id === currentUser?.id && (
                        <span className="rounded-md bg-[color:var(--app-accent-soft)] px-1.5 py-0.5 text-[10px] font-bold text-app-accent">
                          {t("common.you")}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setEditingProfile(profile)}
                        className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-blue-700"
                      >
                        <Pencil className="h-3 w-3" />
                        {t("common.edit")}
                      </button>
                    </div>
                  </td>
                  <td className="px-6 py-3.5 text-app-muted">{profile.email || "-"}</td>
                  <td className="px-6 py-3.5">
                    <select
                      value={profile.role_id || ""}
                      onChange={(e) => void handleRoleChange(profile.id, e.target.value)}
                      className="rounded-lg app-card px-2 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[color:var(--app-accent-ring)]"
                    >
                      <option value="">{t("common.noRole")}</option>
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-6 py-3.5">
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                        profile.is_active
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-app-card-hover text-app-muted"
                      }`}
                    >
                      {profile.is_active ? t("common.active") : t("common.inactive")}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 text-app-muted">
                    {formatDate(profile.created_at)}
                  </td>
                  <td className="px-6 py-3.5 text-right">
                    <button
                      type="button"
                      onClick={() => void handleToggleActive(profile)}
                      disabled={profile.id === currentUser?.id}
                      title={
                        profile.id === currentUser?.id
                          ? t("common.cannotDeactivateSelf")
                          : undefined
                      }
                      className="rounded-lg border border-app px-3 py-1.5 text-[11px] font-semibold text-app-muted transition-colors hover:bg-app-card-hover disabled:opacity-40"
                    >
                      {profile.is_active ? t("common.deactivate") : t("common.activate")}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-app-muted">
        <ShieldCheck className="h-3.5 w-3.5 text-app-muted" />
        {t("users.permissionsHint")}
      </p>

      {showInvite && (
        <InviteUserModal
          roles={roles}
          onClose={() => setShowInvite(false)}
          onInvited={(message) => {
            setShowInvite(false);
            flash(message);
            void loadData();
          }}
        />
      )}

      {editingProfile && (
        <EditUserModal
          profile={editingProfile}
          roles={roles}
          currentUserId={currentUser?.id}
          onClose={() => setEditingProfile(null)}
          onSaved={async (message) => {
            const editedId = editingProfile.id;
            setEditingProfile(null);
            flash(message);
            await loadData();
            if (editedId === currentUser?.id) await refreshAuth();
          }}
        />
      )}
    </div>
  );
}

export default function UsersPage() {
  const { t } = useI18n();

  return (
    <PageLayout>
        <div className="border-b border-app bg-app-surface px-6 py-4 backdrop-blur-md">
          <h1 className="flex items-center gap-2 text-xl font-bold text-app">
            <UsersIcon className="h-6 w-6 text-app-accent" />
            {t("users.pageTitle")}
          </h1>
          <p className="mt-0.5 text-xs text-app-muted">{t("users.pageDescription")}</p>
        </div>

        <SettingsTabs activeTab="users" />

        <PermissionGuard permission="can_manage_users">
          <UsersView />
        </PermissionGuard>
      </PageLayout>
  );
}
