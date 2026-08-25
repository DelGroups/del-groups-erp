import { type NextRequest, NextResponse } from "next/server";
import { getSiteUrl } from "@/lib/env";
import { handleOptions, jsonWithCors } from "@/lib/apiSecurity";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { canAssignRole, requirePermissionApi } from "@/lib/auth/apiAuth";
import {
  clampString,
  EMAIL_PATTERN,
  isValidUuid,
  normalizeEmail,
} from "@/lib/auth/validate";
import { getClientIp, rateLimit } from "@/lib/rateLimit";

interface InviteBody {
  email?: string;
  full_name?: string;
  role_id?: string;
}

const MAX_NAME_LENGTH = 200;
const INVITE_RATE_LIMIT = 10;
const INVITE_WINDOW_MS = 60_000;

export function OPTIONS() {
  return handleOptions();
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const limit = rateLimit(`invite:${ip}`, INVITE_RATE_LIMIT, INVITE_WINDOW_MS);
  if (!limit.allowed) {
    return jsonWithCors(
      { error: "Çox sayda sorğu. Bir az gözləyin." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((limit.resetAt - Date.now()) / 1000)),
        },
      }
    );
  }

  const auth = await requirePermissionApi("can_manage_users");
  if (auth.error) return auth.error;

  let body: InviteBody;
  try {
    body = (await request.json()) as InviteBody;
  } catch {
    return NextResponse.json({ error: "Sorğu formatı yanlışdır" }, { status: 400 });
  }

  const email = normalizeEmail(body.email ?? "");
  const fullName = clampString(body.full_name ?? "", MAX_NAME_LENGTH);
  const roleId = (body.role_id ?? "").trim();

  if (!EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "E-poçt ünvanı düzgün deyil" }, { status: 400 });
  }
  if (!fullName) {
    return NextResponse.json({ error: "Ad Soyad tələb olunur" }, { status: 400 });
  }
  if (!roleId || !isValidUuid(roleId)) {
    return NextResponse.json({ error: "Etibarlı rol seçilməlidir" }, { status: 400 });
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

  const redirectTo = new URL("/auth/set-password", getSiteUrl());

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    email,
    {
      data: { full_name: fullName, role_name: role.name },
      redirectTo: redirectTo.toString(),
    }
  );

  if (inviteError || !invited?.user) {
    const alreadyRegistered = /already been registered|already exists/i.test(
      inviteError?.message ?? ""
    );
    return NextResponse.json(
      {
        error: alreadyRegistered
          ? "Bu e-poçt ünvanı ilə istifadəçi artıq mövcuddur"
          : inviteError?.message || "Dəvət göndərilə bilmədi",
      },
      { status: alreadyRegistered ? 409 : 400 }
    );
  }

  const { error: profileError } = await admin.from("profiles").upsert(
    {
      id: invited.user.id,
      email,
      full_name: fullName,
      role_id: role.id,
      is_active: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (profileError) {
    return NextResponse.json(
      {
        error: `İstifadəçi dəvət olundu, lakin profil yazıla bilmədi: ${profileError.message}`,
      },
      { status: 500 }
    );
  }

  return jsonWithCors({
    success: true,
    user: { id: invited.user.id, email, full_name: fullName, role_name: role.name },
  });
}
