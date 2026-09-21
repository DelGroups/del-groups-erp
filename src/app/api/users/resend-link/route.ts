import { type NextRequest, NextResponse } from "next/server";
import { getSiteUrl } from "@/lib/env";
import { handleOptions, jsonWithCors } from "@/lib/apiSecurity";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { requirePermissionApi } from "@/lib/auth/apiAuth";
import { isValidUuid } from "@/lib/auth/validate";
import { getClientIp, rateLimit } from "@/lib/rateLimit";

interface ResendLinkBody {
  user_id?: string;
}

const RESEND_RATE_LIMIT = 10;
const RESEND_WINDOW_MS = 60_000;

export function OPTIONS() {
  return handleOptions();
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const limit = rateLimit(`resend-link:${ip}`, RESEND_RATE_LIMIT, RESEND_WINDOW_MS);
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

  let body: ResendLinkBody;
  try {
    body = (await request.json()) as ResendLinkBody;
  } catch {
    return NextResponse.json({ error: "Sorğu formatı yanlışdır" }, { status: 400 });
  }

  const userId = (body.user_id ?? "").trim();
  if (!isValidUuid(userId)) {
    return NextResponse.json({ error: "Etibarsız istifadəçi identifikatoru" }, { status: 400 });
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

  const { data: userRecord, error: getUserError } = await admin.auth.admin.getUserById(userId);
  if (getUserError || !userRecord?.user?.email) {
    return NextResponse.json({ error: "İstifadəçi tapılmadı" }, { status: 404 });
  }

  const email = userRecord.user.email;
  // A user who has never signed in is still on their original invite —
  // resend the invite rather than a password-recovery link, since
  // inviteUserByEmail rejects emails that have already been confirmed.
  const neverSignedIn = !userRecord.user.last_sign_in_at;

  if (neverSignedIn) {
    const redirectTo = new URL("/auth/set-password", getSiteUrl());
    const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: redirectTo.toString(),
    });

    if (inviteError) {
      return NextResponse.json({ error: inviteError.message }, { status: 400 });
    }
  } else {
    const redirectTo = new URL("/update-password", getSiteUrl());
    const { error: resetError } = await admin.auth.resetPasswordForEmail(email, {
      redirectTo: redirectTo.toString(),
    });

    if (resetError) {
      return NextResponse.json({ error: resetError.message }, { status: 400 });
    }
  }

  return jsonWithCors({ success: true, email });
}
