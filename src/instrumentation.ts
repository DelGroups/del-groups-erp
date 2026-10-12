/**
 * Runs once when the server starts (Next.js instrumentation). Registers the request
 * headers helper the admin client uses in multi-tenant mode (src/lib/tenant/request.ts),
 * so that client bundles importing shared modules never pull in next/headers.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/tenant/request");
  }
}
