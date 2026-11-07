/**
 * The tenant's admin in the ERP's own Supabase Auth. The ERP's on_auth_user_created trigger
 * gives the user the role named in role_name ("Admin"); the profile is also written
 * directly, the same way the ERP's invite route does it.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { TenantAuth } from "./engine.ts";

const ALREADY_REGISTERED = /already (been )?registered|already exists/i;

type Fetch = typeof fetch;

function adminClient(apiUrl: string, serviceRoleKey: string, fetchImpl?: Fetch): SupabaseClient {
  return createClient(apiUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(fetchImpl ? { global: { fetch: fetchImpl } } : {}),
  });
}

async function writeAdminProfile(admin: SupabaseClient, userId: string, email: string, fullName: string, what: string): Promise<void> {
  const { data: role, error: roleError } = await admin.from("roles").select("id").eq("name", "Admin").maybeSingle();
  if (roleError || !role) {
    throw new Error(`${what}, but the Admin role was not found: ${roleError?.message ?? "missing"}`);
  }
  const { error: profileError } = await admin.from("profiles").upsert(
    { id: userId, email, full_name: fullName, role_id: role.id, is_active: true, updated_at: new Date().toISOString() },
    { onConflict: "id" }
  );
  if (profileError) throw new Error(`${what}, but the profile was not written: ${profileError.message}`);
}

/** The adapter; tests pass a fake fetch, the app uses the global one. */
export function createTenantAuth(options: { fetch?: Fetch } = {}): TenantAuth {
  return {
    async inviteAdmin({ apiUrl, serviceRoleKey, email, fullName, redirectTo }) {
      const admin = adminClient(apiUrl, serviceRoleKey, options.fetch);
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName, role_name: "Admin" },
        redirectTo,
      });
      if (error) {
        if (ALREADY_REGISTERED.test(error.message)) return "exists";
        throw new Error(`invite failed: ${error.message}`);
      }
      await writeAdminProfile(admin, data.user.id, email, fullName, "invite sent");
      return "invited";
    },

    async generateAdminLink({ apiUrl, serviceRoleKey, email, fullName, redirectTo }) {
      const admin = adminClient(apiUrl, serviceRoleKey, options.fetch);
      // No email is sent: generateLink only returns the link, Del sends it himself.
      const invite = await admin.auth.admin.generateLink({
        type: "invite",
        email,
        options: { data: { full_name: fullName, role_name: "Admin" }, redirectTo },
      });
      if (!invite.error) {
        await writeAdminProfile(admin, invite.data.user.id, email, fullName, "invite link created");
        return { link: invite.data.properties.action_link, kind: "invite" };
      }
      if (!ALREADY_REGISTERED.test(invite.error.message)) throw new Error(`invite link failed: ${invite.error.message}`);

      // The admin already has a password: a recovery link lets them set a new one.
      const recovery = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } });
      if (recovery.error) throw new Error(`password link failed: ${recovery.error.message}`);
      return { link: recovery.data.properties.action_link, kind: "recovery" };
    },
  };
}

export const supabaseTenantAuth: TenantAuth = createTenantAuth();
