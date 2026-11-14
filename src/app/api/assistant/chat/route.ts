import { type NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuthenticatedApi } from "@/lib/auth/apiAuth";
import { clampString } from "@/lib/auth/validate";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { assistantAccess } from "@/lib/assistant/config";
import { parseClientContext } from "@/lib/assistant/context";
import { runAssistantTurn } from "@/lib/assistant/engine";
import type { AssistantLanguage } from "@/lib/assistant/prompt";
import { encodeSse, type AssistantStreamEvent } from "@/lib/assistant/sse";
import { ensureConversation, loadHistory, saveTurn } from "@/lib/ai/native/store";
import type { AgentResult } from "@/lib/ai/native/agent";
import { PRODUCT_NAME } from "@/lib/brand";
import { loadCompanyProfile } from "@/lib/company/loadCompanyProfile";
import { companyDisplayName, EMPTY_COMPANY_PROFILE } from "@/lib/company/profile";
import { getEnabledModules, requireModuleApi } from "@/lib/modules/server";
import { checkUsage } from "@/lib/limits/server";
import { limitResponse } from "@/lib/limits/messages";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { isAdminRole } from "@/types/database.types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_MESSAGE = 4000;
const MAX_HISTORY = 12;
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

/**
 * Del Assistant chat (AST-1): POST { message, conversationId?, locale?, context? } → text/event-stream of
 * AssistantStreamEvent (src/lib/assistant/sse.ts). Signed-in users only, ASSISTANT_V2 on and in its audience
 * (admins by default), the plan's AI module and credit, a per-user rate limit and the monthly budget.
 * Every read runs with the user's own client; nothing is written except the conversation and the usage log.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedApi();
  if (auth.error) return auth.error;
  const notInPlan = await requireModuleApi("ai");
  if (notInPlan) return notInPlan;

  const isAdmin = isAdminRole(auth.profile?.role);
  const access = assistantAccess({ isAdmin });
  if (!access.enabled) return NextResponse.json({ error: "Assistant is not enabled" }, { status: 404 });

  const limit = rateLimit(`assistant:${auth.user.id}:${getClientIp(request)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } });
  }
  const quota = await checkUsage("ai");
  if (!quota.allowed) return limitResponse("ai", quota.usage);

  let body: { message?: unknown; conversationId?: unknown; locale?: unknown; context?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const message = clampString(String(body.message ?? ""), MAX_MESSAGE);
  if (!message) return NextResponse.json({ error: "Message required" }, { status: 400 });
  const language: AssistantLanguage = body.locale === "en" || body.locale === "ru" ? body.locale : "az";
  const clientContext = parseClientContext(body.context);

  const client = auth.client as unknown as SupabaseClient;
  const requested = typeof body.conversationId === "string" ? body.conversationId : null;
  const history = (await loadHistory(client, requested, MAX_HISTORY)) ?? [];
  while (history.length && history[0].role !== "user") history.shift();
  const conversationId = await ensureConversation(client, auth.user.id, requested, message);
  const { profile: company } = await loadCompanyProfile(client).catch(() => ({ profile: EMPTY_COMPANY_PROFILE }));
  const enabledModules = await getEnabledModules();
  const admin = await createSupabaseAdminClient();
  const started = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: AssistantStreamEvent) => controller.enqueue(encoder.encode(encodeSse(event)));
      let result: AgentResult | null = null;
      let status = "ok";
      let routeReason = "";
      send({ type: "start", conversationId });
      try {
        const turn = await runAssistantTurn({
          apiKey: access.apiKey,
          db: client,
          profile: auth.profile,
          isAdmin,
          enabledModules,
          language,
          productName: PRODUCT_NAME,
          company: { name: companyDisplayName(company, PRODUCT_NAME), currency: company.defaultCurrency },
          userName: auth.profile?.full_name || auth.user.email || "colleague",
          history,
          message,
          clientContext,
          monthSpent: async () => {
            const { data, error } = await admin.rpc("assistant_month_cost" as never);
            if (error) throw new Error(error.message);
            const n = Number(data);
            return Number.isFinite(n) ? n : 0;
          },
          onEvent: (event) => send(event),
        });
        if (!turn.ok) {
          status = "budget";
          send({ type: "error", reason: "budget", message: turn.message });
        } else {
          result = turn.result;
          status = result.status;
          routeReason = turn.route.reason;
          send({
            type: "done",
            reply: result.reply,
            status: result.status,
            links: result.links.filter((l) => l.href.startsWith("/") && !l.href.startsWith("//")),
            conversationId,
            skills: turn.skills,
            tier: turn.route.tier,
          });
          if (result.status === "refusal") send({ type: "error", reason: "refused", message: "The request was declined." });
        }
      } catch (err) {
        status = "error";
        const text = err instanceof Anthropic.APIError ? `API ${err.status}: ${err.message}` : err instanceof Error ? err.message : String(err);
        console.warn(`[assistant] turn failed: ${text}`);
        send({ type: "error", reason: "unavailable", message: text.slice(0, 300) });
      } finally {
        await saveTurn(client, {
          userId: auth.user.id,
          conversationId,
          userMessage: message,
          result,
          routeReason,
          latencyMs: Date.now() - started,
          status,
          source: "assistant_v2",
          context: { page: clientContext.page, recordType: clientContext.recordType, recordId: clientContext.recordId },
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
