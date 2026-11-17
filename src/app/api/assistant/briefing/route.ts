import { type NextRequest, NextResponse } from "next/server";
import { isValidUuid } from "@/lib/auth/validate";
import { bakuToday } from "@/lib/assistant/watch/context";
import { assistantHistoryGate } from "../conversations/gate";

export const dynamic = "force-dynamic";

/**
 * GET (AST-6): today's morning briefing of the signed-in user, or { briefing: null }. Read with the user's
 * own session (each person sees only their own row). POST { id } marks it read.
 */
export async function GET() {
  const gate = await assistantHistoryGate();
  if (gate.error) return gate.error;
  const { data, error } = await gate.client
    .from("assistant_briefings")
    .select("id, day, body, all_well, links, seen_at")
    .eq("user_id", gate.userId)
    .eq("day", bakuToday())
    .maybeSingle();
  if (error) return NextResponse.json({ briefing: null });
  return NextResponse.json({ briefing: data ?? null });
}

export async function POST(request: NextRequest) {
  const gate = await assistantHistoryGate();
  if (gate.error) return gate.error;
  let body: { id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!isValidUuid(id)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { data } = await gate.client.rpc("assistant_briefing_seen" as never, { p_id: id } as never);
  return NextResponse.json({ ok: data === true });
}
