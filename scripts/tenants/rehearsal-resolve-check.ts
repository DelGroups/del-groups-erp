/**
 * Rehearsal helper (scripts/tenants/rehearse-tenant-1.sh): asks the ERP's own tenant
 * resolver (src/lib/tenant/resolve.ts) what it would serve for erp.del-groups.com, with the
 * control plane's erp_tenant_runtime() answered by a local Postgres instead of PostgREST.
 *
 *   CONTROL_PLANE_DB_URL=... EXPECT_REF=... EXPECT_ANON=... EXPECT_SERVICE=... node ... rehearsal-resolve-check.ts
 *
 * Prints what resolves (keys only as match / mismatch) and exits 1 on any difference.
 */
import { createTenantResolver, tenantAccess } from "../../src/lib/tenant/resolve.ts";
import { psql } from "./local.ts";

const cp = process.env.CONTROL_PLANE_DB_URL ?? "";
const expected = {
  apiUrl: `https://${process.env.EXPECT_REF ?? ""}.supabase.co`,
  anonKey: process.env.EXPECT_ANON ?? "",
  serviceRoleKey: process.env.EXPECT_SERVICE ?? "",
};

const resolver = createTenantResolver({
  controlPlane: { url: "http://control-plane.rehearsal", serviceRoleKey: "rehearsal" },
  production: true,
  fetch: async (_input, init) => {
    const body = JSON.parse(String(init.body)) as { p_host: string | null; p_tenant_id: string | null };
    const out = psql(
      cp,
      `select coalesce(json_agg(r), '[]') from public.erp_tenant_runtime(nullif(:'h', ''), nullif(:'t', '')::uuid) r;`,
      { h: body.p_host ?? "", t: body.p_tenant_id ?? "" }
    );
    return new Response(out, { status: 200, headers: { "Content-Type": "application/json" } });
  },
});

let ok = true;
const check = (label: string, good: boolean, detail: string) => {
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}: ${detail}`);
  ok &&= good;
};

const tenant = await resolver.byHost("erp.del-groups.com");
check("erp.del-groups.com resolves", tenant !== null, tenant ? `tenant ${tenant.slug} (${tenant.tenantId})` : "unknown host");
if (tenant) {
  check("status", tenant.status === "active", `${tenant.status}; pages: ${tenantAccess(tenant.status, "GET").kind}, saving: ${tenantAccess(tenant.status, "POST").kind}`);
  check("Supabase URL", tenant.apiUrl === expected.apiUrl, tenant.apiUrl);
  check("anon key from Vault", tenant.anonKey === expected.anonKey, tenant.anonKey === expected.anonKey ? "matches" : "differs");
  check("service-role key from Vault", tenant.serviceRoleKey === expected.serviceRoleKey, tenant.serviceRoleKey === expected.serviceRoleKey ? "matches" : "differs");
  const byId = await resolver.byId(tenant.tenantId);
  check("lookup by id (server code)", byId?.slug === tenant.slug, byId?.slug ?? "none");
}
const unknown = await resolver.byHost("not-registered.example.com");
check("an unregistered host stays unknown", unknown === null, unknown ? unknown.slug : "unknown (404 page)");
process.exit(ok ? 0 : 1);
