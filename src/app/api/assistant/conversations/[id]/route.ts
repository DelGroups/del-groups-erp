import { type NextRequest, NextResponse } from "next/server";
import { isValidUuid } from "@/lib/auth/validate";
import { hiddenContext, isHidden, parsePatch } from "@/lib/assistant/history";
import { assistantHistoryGate } from "../gate";

export const dynamic = "force-dynamic";

const MAX_MESSAGES = 200;

type Ctx = { params: Promise<{ id: string }> };

/** GET: one of the user's conversations with its messages, oldest first (AST-2). */
export async function GET(_request: NextRequest, { params }: Ctx) {
  const gate = await assistantHistoryGate();
  if (gate.error) return gate.error;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const conv = await gate.client.from("ai_conversations").select("id, title, context").eq("id", id).eq("user_id", gate.userId).maybeSingle();
  if (conv.error || !conv.data || isHidden((conv.data as { context?: unknown }).context)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { data, error } = await gate.client
    .from("ai_messages")
    .select("id, role, content, steps, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true })
    .limit(MAX_MESSAGES);
  if (error) return NextResponse.json({ error: "Could not load messages" }, { status: 500 });
  return NextResponse.json({ id, title: (conv.data as { title?: string | null }).title ?? "", messages: data ?? [] });
}

/** PATCH { title } renames; PATCH { hidden: true } removes it from the list (soft delete, AST-2). */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const gate = await assistantHistoryGate();
  if (gate.error) return gate.error;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const patch = parsePatch(body);
  if (patch.kind === "invalid") return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const current = await gate.client.from("ai_conversations").select("id, context").eq("id", id).eq("user_id", gate.userId).maybeSingle();
  if (current.error || !current.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const update = patch.kind === "rename" ? { title: patch.title } : { context: hiddenContext((current.data as { context?: unknown }).context) };
  const { error } = await gate.client.from("ai_conversations").update(update).eq("id", id).eq("user_id", gate.userId);
  if (error) return NextResponse.json({ error: "Could not save" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
