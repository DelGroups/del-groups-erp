/**
 * Invites the tenant's first admin into the new ERP's own Supabase Auth. The ERP's
 * on_auth_user_created trigger gives the user the role named in role_name ("Admin"); the
 * profile is also written directly, the same way the ERP's invite route does it.
 */
import { createClient } from "@supabase/supabase-js";
import type { TenantAuth } from "./engine.ts";

export const supabaseTenantAuth: TenantAuth = {
  async inviteAdmin({ apiUrl, serviceRoleKey, email, fullName, redirectTo }) {
    const admin = createClient(apiUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName, role_name: "Admin" },
      redirectTo,
    });
    if (error) {
      if (/already (been )?registered|already exists/i.test(error.message)) return "exists";
      throw new Error(`invite failed: ${error.message}`);
    }
    const { data: role, error: roleError } = await admin.from("roles").select("id").eq("name", "Admin").maybeSingle();
    if (roleError || !role) {
      throw new Error(`invite sent, but the Admin role was not found: ${roleError?.message ?? "missing"}`);
    }
    const { error: profileError } = await admin.from("profiles").upsert(
      { id: data.user.id, email, full_name: fullName, role_id: role.id, is_active: true, updated_at: new Date().toISOString() },
      { onConflict: "id" }
    );
    if (profileError) throw new Error(`invite sent, but the profile was not written: ${profileError.message}`);
    return "invited";
  },
};
