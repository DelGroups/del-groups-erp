/**
 * Localized refusals for plan limits (prompt 12). Server only. The text lives in src/i18n
 * (limits.*); `code` lets the UI show the matching nudge.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getMessages } from "@/i18n/messages";
import { translate } from "@/i18n/translate";
import { LOCALE_COOKIE, resolveLocale, type Locale } from "@/i18n/types";
import { formatBytesShort, LIMIT_ERROR, type LimitKind, type LimitUsage } from "./limits";
import { checkUsage } from "./server";

const MESSAGE_KEY: Record<LimitKind, string> = {
  users: "limits.seatLimitReached",
  storage: "limits.storageLimitReached",
  ai: "limits.aiLimitReached",
};

export function limitMessage(kind: LimitKind, usage: LimitUsage, locale: Locale): string {
  return translate(getMessages(locale), MESSAGE_KEY[kind], {
    used: kind === "storage" ? formatBytesShort(usage.used) : kind === "ai" ? usage.used.toFixed(2) : usage.used,
    limit: usage.limit === null ? "∞" : kind === "storage" ? formatBytesShort(usage.limit) : kind === "ai" ? usage.limit.toFixed(2) : usage.limit,
  });
}


/** The request user's locale (cookie), for API routes and server actions. */
export async function requestLocale(): Promise<Locale> {
  try {
    return resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  } catch {
    return resolveLocale(null);
  }
}

/** 403 with a localized message and a machine-readable code. */
export async function limitResponse(kind: LimitKind, usage: LimitUsage): Promise<NextResponse> {
  const locale = await requestLocale();
  return NextResponse.json(
    { error: limitMessage(kind, usage, locale), code: LIMIT_ERROR[kind], used: usage.used, limit: usage.limit },
    { status: 403 }
  );
}

/**
 * For server-side uploads (service role, so the storage policy does not apply): the
 * localized refusal when the plan's storage is full, else null.
 */
export async function storageFullError(): Promise<string | null> {
  const check = await checkUsage("storage");
  return check.allowed ? null : limitMessage("storage", check.usage, await requestLocale());
}
