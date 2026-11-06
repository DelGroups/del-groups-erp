export const dynamic = "force-dynamic";

/**
 * Liveness of the Node server for the container healthcheck (SAAS-1). Under /api/tenant/, so
 * src/proxy.ts answers it for any Host without a tenant lookup: a multi-tenant container is
 * healthy before any tenant exists and while the control plane is slow. It reads nothing and
 * says nothing beyond "the server answers".
 */
export function GET() {
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
