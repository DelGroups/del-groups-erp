import { NextResponse } from "next/server";
import { getPublicSupabaseConfigStatus } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Serves public Supabase config from server env (works even when NEXT_PUBLIC_* were not inlined at build). */
export async function GET() {
  const status = getPublicSupabaseConfigStatus();

  if (!status.isConfigured) {
    return NextResponse.json(
      {
        configured: false,
        issue: status.configIssue,
        urlPreview: status.rawUrlPreview,
      },
      { status: 503 }
    );
  }

  return NextResponse.json({
    configured: true,
    url: status.url,
    anonKey: status.anonKey,
  });
}
