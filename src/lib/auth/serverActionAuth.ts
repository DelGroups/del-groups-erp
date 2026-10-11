import type { PermissionKey, UserProfile } from "@/types/database.types";
import type { User } from "@supabase/supabase-js";
import { getServerAuthContext } from "@/lib/supabaseServer";
import { userHasPermission } from "@/lib/auth/routePermissions";
import { assertModulesEnabled } from "@/lib/modules/server";
import { moduleForPermission } from "@/modules/enabled";
import type { ModuleId } from "@/modules/types";

export class ActionAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionAuthError";
  }
}

export type ActionAuthContext = {
  user: User;
  profile: UserProfile | null;
};

/**
 * Signed-in, active user with `permission`, in a module the tenant has: the
 * module that owns the permission and, if given, `options.module` (for actions
 * of a module that reuses another module's permission, e.g. CRM settings).
 */
export async function requirePermissionAction(
  permission: PermissionKey,
  options?: { module?: ModuleId }
): Promise<ActionAuthContext> {
  const { user, profile } = await getServerAuthContext();

  if (!user) {
    throw new ActionAuthError("Giriş tələb olunur");
  }

  if (profile?.is_active === false) {
    throw new ActionAuthError("Hesabınız deaktiv edilib. Administratorla əlaqə saxlayın.");
  }

  const allowed = userHasPermission(profile, permission);

  if (!allowed) {
    throw new ActionAuthError("İcazəniz yoxdur");
  }

  await assertModulesEnabled(moduleForPermission(permission), options?.module);

  return { user, profile };
}

export function mapRpcError(message: string): string {
  if (message.includes("forbidden")) return "İcazəniz yoxdur";
  if (message.includes("insufficient_balance")) return "Hesab balansı kifayət etmir";
  if (message.includes("account_not_found")) return "Hesab tapılmadı";
  if (message.includes("employee_not_found")) return "İşçi tapılmadı";
  if (message.includes("invalid_commission_ids")) return "Seçilmiş komissiyalar etibarsızdır və ya artıq ödənilib";
  if (message.includes("net_amount_zero")) return "Net maaş məbləği sıfırdan böyük olmalıdır";
  if (message.includes("invalid_amount")) return "Məbləğ düzgün deyil";
  if (message.includes("invalid_quality_score") || message.includes("invalid_delivery_score")) {
    return "Qiymət 1-5 ulduz arasında olmalıdır";
  }
  return message;
}
