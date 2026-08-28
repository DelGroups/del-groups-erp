import type { PermissionKey, UserProfile } from "@/types/database.types";
import type { User } from "@supabase/supabase-js";
import { getServerAuthContext } from "@/lib/supabaseServer";
import { userHasPermission } from "@/lib/auth/routePermissions";

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

export async function requirePermissionAction(
  permission: PermissionKey
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
  return message;
}
