import { NextResponse } from "next/server";
import { getServerAuthContext } from "@/lib/supabaseServer";
import {
  ADMIN_ROLE_NAME,
  hasPermission,
  isAdminRole,
  type PermissionKey,
  type UserProfile,
} from "@/types/database.types";
import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

export type ApiAuthSuccess = {
  error: null;
  client: SupabaseClient<Database>;
  user: User;
  profile: UserProfile | null;
};

export type ApiAuthFailure = {
  error: NextResponse;
  client?: SupabaseClient<Database>;
  user?: User | null;
  profile?: UserProfile | null;
};

export async function requireAuthenticatedApi(): Promise<ApiAuthSuccess | ApiAuthFailure> {
  const { client, user, profile } = await getServerAuthContext();

  if (!user) {
    return {
      error: NextResponse.json({ error: "Giriş tələb olunur" }, { status: 401 }),
    };
  }

  if (profile?.is_active === false) {
    return {
      error: NextResponse.json(
        { error: "Hesabınız deaktiv edilib. Administratorla əlaqə saxlayın." },
        { status: 403 }
      ),
      client,
      user,
      profile,
    };
  }

  return { error: null, client, user, profile };
}

export async function requirePermissionApi(
  permission: PermissionKey
): Promise<ApiAuthSuccess | ApiAuthFailure> {
  const auth = await requireAuthenticatedApi();
  if (auth.error) return auth;

  const allowed =
    isAdminRole(auth.profile?.role) ||
    hasPermission(auth.profile?.role?.permissions, permission);

  if (!allowed) {
    return {
      ...auth,
      error: NextResponse.json({ error: "İcazəniz yoxdur" }, { status: 403 }),
    };
  }

  return auth;
}

/** Only full administrators may assign the Admin role to new users. */
export function canAssignRole(
  callerProfile: UserProfile | null,
  targetRoleName: string
): boolean {
  if (targetRoleName === ADMIN_ROLE_NAME) {
    return isAdminRole(callerProfile?.role);
  }
  return (
    isAdminRole(callerProfile?.role) ||
    hasPermission(callerProfile?.role?.permissions, "can_manage_users")
  );
}
