// SAAS-1: the trial stack's compose file, env template and health route. The images are built
// and the trial ERP is started in .github/workflows/saas-images.yml; this keeps the guarantees
// that protect production in one place.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** The text of one top-level service block of a compose file. */
function service(compose, name) {
  const m = new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z][a-z-]*:\\n|\\nnetworks:)`).exec(compose);
  assert.ok(m, `service ${name}`);
  return m[1];
}

test("docker-compose.saas.yml: its own project, the shared network, loopback ports and limits", () => {
  const compose = read("docker-compose.saas.yml");
  assert.match(compose, /^name: del-groups-saas$/m);
  assert.match(compose, /networks:\n  edge:\n    external: true\n    name: del-social-ai_frontend/);

  const erp = service(compose, "erp-saas");
  assert.match(erp, /context: \.\n/);
  assert.match(erp, /image: del-groups-erp-saas:latest/, "never the production image tag");
  assert.match(erp, /path: \/opt\/del-groups-erp\/\.env\.saas/);
  assert.match(erp, /"127\.0\.0\.1:3003:3000"/);
  assert.match(erp, /mem_limit: 1g/);
  assert.match(erp, /aliases: \[erp-saas\]/);
  assert.match(erp, /max-size: "10m"\n        max-file: "3"/);
  // No production Supabase project baked into the trial image.
  assert.match(erp, /NEXT_PUBLIC_SUPABASE_URL: ""\n\s+NEXT_PUBLIC_SUPABASE_ANON_KEY: ""/);
  // Healthy before any tenant exists.
  assert.match(erp, /test: \["CMD", "wget", "-qO-", "http:\/\/127\.0\.0\.1:3000\/api\/tenant\/health"\]/);

  const cp = service(compose, "control-panel");
  assert.match(cp, /dockerfile: control-panel\/Dockerfile/);
  assert.match(cp, /context: \.\n/);
  assert.match(cp, /path: \/opt\/del-groups-erp\/\.env\.control-panel/);
  assert.match(cp, /"127\.0\.0\.1:3100:3100"/);
  assert.match(cp, /mem_limit: 512m/);
  assert.match(cp, /aliases: \[control-panel\]/);
  assert.match(cp, /NEXT_PUBLIC_SUPABASE_URL: \$\{NEXT_PUBLIC_SUPABASE_URL:\?/);

  // Production's compose file is not part of this stack and keeps its own project and image.
  const prod = read("docker-compose.prod.yml");
  assert.match(prod, /image: del-groups-erp:latest/);
  assert.match(prod, /aliases: \[erp\]/);
  assert.doesNotMatch(prod, /erp-saas|control-panel/);
});

test(".env.saas.example names what multi-tenant mode needs and keeps production keys out", () => {
  const env = read(".env.saas.example");
  const set = env.split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.slice(0, l.indexOf("=")));
  for (const name of ["CONTROL_PLANE_URL", "CONTROL_PLANE_SERVICE_ROLE_KEY", "TENANT_WEBHOOK_SECRET", "NEXT_PUBLIC_SITE_URL", "ERP_HEALTHCHECK_HOST"]) {
    assert.ok(set.includes(name), name);
  }
  for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) {
    assert.ok(!set.includes(name), `${name} must not be in .env.saas`);
    assert.match(env, new RegExp(`#\\s+${name}\\s+must NOT be in this file`), `${name} warned about`);
  }
  // Names only: every variable is empty except the public product URL.
  const valued = env.split("\n").filter((l) => /^[A-Z_]+=./.test(l));
  assert.deepEqual(valued, ["NEXT_PUBLIC_SITE_URL=https://erp.del-groups.com"]);

  const cp = read("control-panel/.env.example");
  assert.match(cp, /TENANT_BASE_DOMAIN=erp\.del-groups\.com/);
  assert.match(cp, /ERP_TENANT_WEBHOOK_URL=http:\/\/erp-saas:3000\/api\/tenant\/invalidate/);
});

test("/api/tenant/health answers for any host without a tenant lookup", async () => {
  const proxy = read("src/proxy.ts");
  assert.match(proxy, /const TENANTLESS_API_PREFIX = "\/api\/tenant\/";/);
  assert.match(proxy, /if \(pathname\.startsWith\(TENANTLESS_API_PREFIX\)\) \{\n\s+return NextResponse\.next/);
  const { GET } = await import("../src/app/api/tenant/health/route.ts");
  const res = GET();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("the runbook keeps production and Del Social AI untouched", () => {
  const rb = read("docs/runbooks/saas-trial-stack.md");
  assert.match(rb, /ask http:\/\/erp-saas:3000\/api\/tenant\/domain-check/);
  assert.match(rb, /cp\.del-groups\.com \{\n\tencode zstd gzip\n\treverse_proxy control-panel:3100\n\}/);
  assert.match(rb, /https:\/\/ \{\n\ttls \{\n\t\ton_demand\n\t\}/);
  assert.match(rb, /caddy validate/);
  for (const host of ["erp.del-groups.com", "app.del-groups.com", "ai.del-groups.com", "api.del-groups.com", "panel.del-groups.com"]) {
    assert.ok(rb.includes(host), host);
  }
  assert.match(rb, /install -m 755 -o root -g root \/opt\/del-groups-erp\/scripts\/server\/erp-deploy\.sh \/usr\/local\/bin\/del-groups-erp-deploy/);
  assert.match(rb, /## 7\. Rollback/);
});
