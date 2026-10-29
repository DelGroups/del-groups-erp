import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerAuthContext } from "@/lib/supabaseServer";
import { getEnabledModules } from "@/lib/modules/server";
import { isNewUiEnabled } from "@/lib/features/newUi";
import { isNewCrmEnabled } from "@/lib/features/newCrm";
import { isNewHomeEnabled } from "@/lib/features/newHome";
import { canViewFinancials, userHasGranularPermission } from "@/lib/auth/permissionMatrix";
import { isValidUuid } from "@/lib/auth/validate";
import { widgetAccess, widgetDef } from "@/lib/home/registry";
import { finishTodo, LOADERS, WidgetDataError, type LoaderContext } from "@/lib/home/server/loaders";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** What the signed-in user may load; null = not signed in or the home is off. */
async function context(request: Request, id: string) {
  if (!isNewUiEnabled() || !isNewHomeEnabled()) return { status: 404 as const };
  const { client, user, profile, isActive } = await getServerAuthContext();
  if (!user || !isActive) return { status: 401 as const };
  if (!widgetDef(id) || !LOADERS[id]) return { status: 404 as const };
  const enabled = await getEnabledModules();
  const financials = canViewFinancials(profile);
  // Money figures are refused before any query runs (the database refuses them as well).
  const access = widgetAccess(id, {
    isEnabled: (m) => enabled.has(m as never),
    can: (path) => userHasGranularPermission(profile, path),
    financials,
    flags: { newCrm: isNewCrmEnabled() },
  });
  if (access !== 200) return { status: access };
  const ctx: LoaderContext = {
    client: client as unknown as SupabaseClient,
    userId: user.id,
    financials,
    isEnabled: (m) => enabled.has(m as never),
    params: new URL(request.url).searchParams,
    now: new Date(),
  };
  return { status: 200 as const, ctx };
}

/**
 * Data of one home widget (prompt 24b), loaded with the user's own session. 404 while NEW_HOME
 * is off, 403 for a widget the user may not see (a financial widget without
 * dashboard.view_financials, a missing module or permission).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await context(request, id);
  if (c.status !== 200) return NextResponse.json({ error: c.status === 403 ? "forbidden" : c.status === 401 ? "unauthorized" : "not_found" }, { status: c.status, headers: NO_STORE });
  try {
    const data = await LOADERS[id](c.ctx);
    return NextResponse.json({ data, at: c.ctx.now.toISOString() }, { headers: NO_STORE });
  } catch (err) {
    const message = err instanceof WidgetDataError ? err.message : "error";
    if (/forbidden/i.test(message)) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
    console.warn(`[home] widget ${id} failed:`, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "widget_failed" }, { status: 502, headers: NO_STORE });
  }
}

/** Widget actions: "my_todos" finishes one of the user's tasks ({ taskId }). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id !== "my_todos") return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  const c = await context(request, id);
  if (c.status !== 200) return NextResponse.json({ error: "forbidden" }, { status: c.status, headers: NO_STORE });
  const body = (await request.json().catch(() => null)) as { taskId?: unknown } | null;
  const taskId = typeof body?.taskId === "string" ? body.taskId : "";
  if (!isValidUuid(taskId)) return NextResponse.json({ error: "invalid" }, { status: 400, headers: NO_STORE });
  try {
    await finishTodo(c.ctx, taskId);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "error" }, { status: 400, headers: NO_STORE });
  }
}
