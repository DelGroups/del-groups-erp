"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { signOutAndRedirect } from "@/lib/auth/clientSession";
import { isPublicAuthPath } from "@/lib/auth/publicRoutes";
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

function redirectToLogin(pathname: string) {
  if (typeof window === "undefined" || isPublicAuthPath(pathname)) return;
  const next = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
  window.location.replace(`/login${next}`);
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [roleName, setRoleName] = useState("");
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);

  const clearAuthState = useCallback(() => {
    setUser(null);
    setProfile(null);
    setDisplayName("");
    setRoleName("");
  }, []);

  const loadProfile = useCallback(
    async (nextUser: User) => {
      const { data, error } = await supabase
        .from("profiles")
        .select(PROFILE_SELECT)
        .eq("id", nextUser.id)
        .single();

      if (error || !data) {
        console.warn("[auth] Profile missing or fetch failed:", error?.message);
        await signOutAndRedirect("/login?error=no_profile");
        return false;
      }

      const row = data as ProfileQueryRow;

      if (row.is_active === false) {
        await signOutAndRedirect("/login?error=account_inactive");
        return false;
      }

      const joined = parseJoinedRole(row.roles);
      const resolvedFullName =
        (typeof row.full_name === "string" ? row.full_name.trim() : "") ||
        (typeof nextUser.user_metadata?.full_name === "string"
          ? nextUser.user_metadata.full_name.trim()
          : "") ||
        nextUser.email?.split("@")[0] ||
        "";

      setUser(nextUser);
      setRoleName(displayRoleName(joined.name));
      setDisplayName(resolvedFullName);
      setProfile(toUserProfile(row));
      return true;
    },
    []
  );

  useEffect(() => {
    let active = true;

    void (async () => {
      setLoading(true);

      const {
        data: { user: currentUser },
        error,
      } = await supabase.auth.getUser();

      if (!active) return;

      if (error || !currentUser) {
        clearAuthState();
        setLoading(false);
        setReady(true);
        return;
      }

      await loadProfile(currentUser);

      if (active) {
        setLoading(false);
        setReady(true);
      }
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      const nextUser = session?.user ?? null;

      if (event === "SIGNED_OUT" || !nextUser) {
        clearAuthState();
        return;
      }

      await loadProfile(nextUser);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [clearAuthState, loadProfile]);

  useEffect(() => {
    if (!ready || loading) return;
    if (!user) {
      redirectToLogin(pathname);
    }
  }, [ready, loading, user, pathname]);

  const refresh = useCallback(async () => {
    const {
      data: { user: currentUser },
      error,
    } = await supabase.auth.getUser();

    if (error || !currentUser) {
      clearAuthState();
      return;
    }

    await loadProfile(currentUser);
  }, [clearAuthState, loadProfile]);

  const signOut = useCallback(async () => {
    clearAuthState();
    await signOutAndRedirect("/login");
  }, [clearAuthState]);

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
      can: (permission) => Boolean(user && userHasPermission(profile, permission)),
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
