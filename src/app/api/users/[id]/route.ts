import { type NextRequest, NextResponse } from "next/server";
import { handleOptions, jsonWithCors } from "@/lib/apiSecurity";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { canAssignRole, requirePermissionApi } from "@/lib/auth/apiAuth";
import {
  clampString,
  EMAIL_PATTERN,
  isValidUuid,
  normalizeEmail,
} from "@/lib/auth/validate";

interface UpdateUserBody {
  full_name?: string;
  email?: string;
  role_id?: string;
  is_active?: boolean;
  locale?: string;
}

const MAX_NAME_LENGTH = 200;
const LOCALES = new Set(["az", "en", "ru"]);

export function OPTIONS() {
  return handleOptions();
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermissionApi("can_manage_users");
  if (auth.error) return auth.error;

  const { id: userId } = await context.params;
  if (!isValidUuid(userId)) {
    return NextResponse.json({ error: "Etibarsız istifadəçi identifikatoru" }, { status: 400 });
  }

  let body: UpdateUserBody;
  try {
    body = (await request.json()) as UpdateUserBody;
  } catch {
    return NextResponse.json({ error: "Sorğu formatı yanlışdır" }, { status: 400 });
  }

  const fullName =
    body.full_name !== undefined
      ? clampString(body.full_name, MAX_NAME_LENGTH)
      : undefined;
  const email =
    body.email !== undefined ? normalizeEmail(body.email) : undefined;
  const roleId = body.role_id !== undefined ? body.role_id.trim() : undefined;
  const locale = body.locale !== undefined ? body.locale.trim() : undefined;
  const isActive = body.is_active;

  if (fullName !== undefined && !fullName) {
    return NextResponse.json({ error: "Ad Soyad tələb olunur" }, { status: 400 });
  }
  if (email !== undefined && !EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "E-poçt ünvanı düzgün deyil" }, { status: 400 });
  }
  if (roleId !== undefined && !isValidUuid(roleId)) {
    return NextResponse.json({ error: "Etibarlı rol seçilməlidir" }, { status: 400 });
  }
  if (locale !== undefined && !LOCALES.has(locale)) {
    return NextResponse.json({ error: "Etibarlı dil seçilməlidir" }, { status: 400 });
  }
  if (isActive === false && userId === auth.user.id) {
    return NextResponse.json(
      { error: "Öz hesabınızı deaktiv edə bilməzsiniz" },
      { status: 400 }
    );
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server konfiqurasiya xətası" },
      { status: 500 }
    );
  }

  const { data: existingProfile, error: profileFetchError } = await admin
    .from("profiles")
    .select("id, email, full_name, role_id, is_active, locale")
    .eq("id", userId)
    .maybeSingle();

  if (profileFetchError || !existingProfile) {
    return NextResponse.json({ error: "İstifadəçi tapılmadı" }, { status: 404 });
  }

  let targetRoleName: string | undefined;
  if (roleId !== undefined) {
    const { data: role, error: roleError } = await admin
      .from("roles")
      .select("id, name")
      .eq("id", roleId)
      .maybeSingle();

    if (roleError || !role) {
      return NextResponse.json({ error: "Seçilmiş rol tapılmadı" }, { status: 400 });
    }

    if (!canAssignRole(auth.profile, role.name)) {
      return NextResponse.json(
        { error: "Admin rolunu yalnız sistem administratoru təyin edə bilər" },
        { status: 403 }
      );
    }

    targetRoleName = role.name;
  }

  const nextEmail = email ?? existingProfile.email ?? "";
  const nextFullName = fullName ?? existingProfile.full_name ?? "";

  const authUpdatePayload: {
    email?: string;
    user_metadata?: { full_name: string; role_name?: string };
  } = {};

  if (email !== undefined && email !== existingProfile.email) {
    authUpdatePayload.email = email;
  }
  if (fullName !== undefined || targetRoleName) {
    authUpdatePayload.user_metadata = {
      full_name: nextFullName,
      ...(targetRoleName ? { role_name: targetRoleName } : {}),
    };
  }

  if (Object.keys(authUpdatePayload).length > 0) {
    const { error: authUpdateError } = await admin.auth.admin.updateUserById(
      userId,
      authUpdatePayload
    );

    if (authUpdateError) {
      const duplicate = /already been registered|already exists/i.test(
        authUpdateError.message
      );
      return NextResponse.json(
        {
          error: duplicate
            ? "Bu e-poçt ünvanı artıq istifadə olunur"
            : authUpdateError.message,
        },
        { status: duplicate ? 409 : 400 }
      );
    }
  }

  const profilePatch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (fullName !== undefined) profilePatch.full_name = fullName;
  if (email !== undefined) profilePatch.email = email;
  if (roleId !== undefined) profilePatch.role_id = roleId;
  if (isActive !== undefined) profilePatch.is_active = isActive;
  if (locale !== undefined) profilePatch.locale = locale;

  const { data: updatedProfile, error: profileUpdateError } = await admin
    .from("profiles")
    .update(profilePatch)
    .eq("id", userId)
    .select("id, email, full_name, role_id, is_active, locale, created_at, updated_at")
    .single();

  if (profileUpdateError || !updatedProfile) {
    return NextResponse.json(
      { error: profileUpdateError?.message || "Profil yenilənmədi" },
      { status: 500 }
    );
  }

  return jsonWithCors({
    success: true,
    user: updatedProfile,
  });
}
