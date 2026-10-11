import { NextResponse, type NextRequest } from "next/server";
import { hasAuthenticatedSession } from "@/lib/auth/homeRouteAuth";
import { isPublicAuthPath } from "@/lib/auth/publicRoutes";
import { isModuleEnabled } from "@/lib/modules/server";
import { moduleForPath } from "@/modules/enabled";
import type { TenantConfigSource } from "@/lib/tenant/config";
import {
  normalizeHost,
  signedTenantHeaders,
  stripTenantHeaders,
  tenantAccess,
  tenantHeaderKey,
} from "@/lib/tenant/resolve";
import { controlPlane, tenantResolver } from "@/lib/tenant/server";

const NOT_IN_PLAN_PATH = "/not-in-plan";

/** Pages src/proxy.ts rewrites to (URL unchanged) for a tenant that cannot be served. */
const TENANT_PAGES = {
  notFound: "/tenant/not-found",
  suspended: "/tenant/suspended",
  preparing: "/tenant/preparing",
  unavailable: "/tenant/unavailable",
} as const;

/** API routes that answer for any host (Caddy's on-demand TLS check, the control-panel webhook). */
const TENANTLESS_API_PREFIX = "/api/tenant/";

/** Query params Supabase attaches to invite/recovery/magic-link redirects. */
const AUTH_LINK_PARAMS = ["code", "token_hash"] as const;

function hasUnconsumedAuthLinkParams(url: URL): boolean {
  return AUTH_LINK_PARAMS.some((key) => url.searchParams.has(key));
}

/**
 * How a response passes the request on: plain in single-tenant mode, with the signed
 * tenant headers in multi-tenant mode.
 */
interface Forward {
  next(): NextResponse;
  rewrite(url: URL): NextResponse;
  /** Where server code reads the tenant from. */
  tenant: TenantConfigSource;
}

/**
 * Next.js 16+ request proxy (successor to middleware.ts).
 *
 * Single-tenant mode (no control plane configured): redirects unauthenticated visitors
 * on protected pages to /login, exactly as before; /api is not touched.
 *
 * Multi-tenant mode (prompt 8): first resolves the tenant from the Host header through
 * the control plane, applies its status (unknown host → 404 page, suspended, being
 * prepared, read-only blocks mutations) and hands the tenant to the app as signed
 * headers, for pages and /api alike. Then the same page rules as above.
 */
export async function proxy(request: NextRequest) {
  const cp = controlPlane();
  if (!cp) {
    if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();
    return pageRules(request, {
      next: () => NextResponse.next(),
      rewrite: (url) => NextResponse.rewrite(url),
      tenant: request,
    });
  }
  return multiTenant(request, tenantHeaderKey(cp));
}

async function multiTenant(request: NextRequest, headerKey: string): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const clean = stripTenantHeaders(request.headers);

  if (pathname.startsWith(TENANTLESS_API_PREFIX)) {
    return NextResponse.next({ request: { headers: clean } });
  }

  const fail = (page: keyof typeof TENANT_PAGES, status: number, error: string) =>
    isApi
      ? NextResponse.json({ error }, { status })
      : NextResponse.rewrite(new URL(TENANT_PAGES[page], request.url), { status, request: { headers: clean } });

  const host = normalizeHost(request.headers.get("host"));
  let record;
  try {
    record = host ? await tenantResolver()!.byHost(host) : null;
  } catch (error) {
    console.error("[tenant] control plane lookup failed:", error instanceof Error ? error.message : error);
    return fail("unavailable", 503, "tenant_lookup_failed");
  }
  if (!record) return fail("notFound", 404, "unknown_tenant");

  const access = tenantAccess(record.status, request.method);
  if (access.kind === "suspended") return fail("suspended", 403, "tenant_suspended");
  if (access.kind === "preparing") return fail("preparing", 503, "tenant_provisioning");
  if (access.kind === "read_only_blocked") {
    return NextResponse.json({ error: "tenant_read_only" }, { status: 403 });
  }

  const headers = clean;
  for (const [name, value] of Object.entries(signedTenantHeaders(record, headerKey))) headers.set(name, value);

  if (isApi) return NextResponse.next({ request: { headers } });
  return pageRules(request, {
    next: () => NextResponse.next({ request: { headers } }),
    rewrite: (url) => NextResponse.rewrite(url, { request: { headers } }),
    tenant: headers,
  });
}

/** Login redirect, auth-link rescue and "not in your plan" for pages (both modes). */
async function pageRules(request: NextRequest, forward: Forward): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (isPublicAuthPath(pathname)) {
    return forward.next();
  }

  // Invite/recovery links must land on the set-password flow even if the
  // Supabase project's configured redirect URL (or a stale email template)
  // sends them somewhere else — never bounce an unconsumed auth code to
  // /login, since that strands the user and burns their one-time link.
  if (hasUnconsumedAuthLinkParams(request.nextUrl)) {
    const isRecovery = request.nextUrl.searchParams.get("type") === "recovery";
    const rescueUrl = new URL(isRecovery ? "/update-password" : "/auth/set-password", request.url);
    request.nextUrl.searchParams.forEach((value, key) => {
      rescueUrl.searchParams.set(key, value);
    });
    return NextResponse.redirect(rescueUrl);
  }

  const authenticated = await hasAuthenticatedSession(request, forward.tenant);
  if (!authenticated) {
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/") {
      loginUrl.searchParams.set("next", pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  // Pages of a module the tenant does not have show "not in your plan" (URL unchanged).
  const moduleId = moduleForPath(pathname);
  if (moduleId && !(await isModuleEnabled(moduleId, forward.tenant))) {
    const notInPlan = new URL(NOT_IN_PLAN_PATH, request.url);
    notInPlan.searchParams.set("module", moduleId);
    return forward.rewrite(notInPlan);
  }

  return forward.next();
}

export const config = {
  // /api is included so multi-tenant mode can resolve the tenant for API routes too;
  // in single-tenant mode the proxy passes /api through untouched.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
