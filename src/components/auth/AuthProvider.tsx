"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import {
  displayRoleName,
  parseJoinedRole,
  userHasPermission,
} from "@/lib/auth/routePermissions";
import {
  PROFILE_SELECT,
  toUserProfile,
  type ProfileQueryRow,
} from "@/lib/auth/profile";
import {
  isAdminRole,
  normalizePermissions,
  type PermissionKey,
  type UserProfile,
} from "@/types/database.types";

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  ready: boolean;
  isAdmin: boolean;
  displayName: string;
  roleName: string;
  email: string;
  can: (permission: PermissionKey) => boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [roleName, setRoleName] = useState("");
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);

  const loadProfile = useCallback(async (nextUser: User | null) => {
    if (!nextUser) {
      setProfile(null);
      setDisplayName("");
      setRoleName("");
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select(PROFILE_SELECT)
      .eq("id", nextUser.id)
      .single();

    if (error) {
      console.warn("Profile fetch failed:", error.message);
    }

    const row = data as ProfileQueryRow | null;

    if (row?.is_active === false) {
      await supabase.auth.signOut();
      setProfile(null);
      setDisplayName("");
      setRoleName("");
      setUser(null);
      window.location.href = "/login?error=account_inactive";
      return;
    }

    const joined = parseJoinedRole(row?.roles);
    const resolvedFullName =
      (typeof row?.full_name === "string" ? row.full_name.trim() : "") ||
      (typeof nextUser.user_metadata?.full_name === "string"
        ? nextUser.user_metadata.full_name.trim()
        : "") ||
      "İstifadəçi";

    setRoleName(displayRoleName(joined.name));
    setDisplayName(resolvedFullName);

    if (row) {
      setProfile(toUserProfile(row));
    } else {
      setProfile({
        id: nextUser.id,
        email: nextUser.email ?? null,
        full_name: resolvedFullName,
        role_id: null,
        employee_id: null,
        is_active: true,
        created_at: null,
        updated_at: null,
        role: {
          id: "",
          name: joined.name,
          description: null,
          permissions: normalizePermissions({}),
          is_system: joined.isAdmin,
          created_at: "",
        },
      });
    }
  }, []);

  useEffect(() => {
    let active = true;

    void (async () => {
      setLoading(true);
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser();
      if (!active) return;
      setUser(currentUser ?? null);
      await loadProfile(currentUser ?? null);
      if (active) {
        setLoading(false);
        setReady(true);
      }
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;
      setUser(nextUser);
      void loadProfile(nextUser);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const refresh = useCallback(async () => {
    const {
      data: { user: currentUser },
    } = await supabase.auth.getUser();
    setUser(currentUser ?? null);
    await loadProfile(currentUser ?? null);
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setDisplayName("");
    setRoleName("");
    window.location.href = "/login";
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const isAdmin = isAdminRole(profile?.role);

    return {
      user,
      profile,
      loading,
      ready,
      isAdmin,
      displayName,
      roleName,
      email: profile?.email || user?.email || "",
      can: (permission) => userHasPermission(profile, permission),
      refresh,
      signOut,
    };
  }, [user, profile, loading, ready, displayName, roleName, refresh, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth AuthProvider daxilində istifadə olunmalıdır");
  }
  return context;
}
