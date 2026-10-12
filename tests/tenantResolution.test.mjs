// Prompt 8: resolving the tenant from the request domain, and what its status allows.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TENANT_STATUSES,
  TENANT_HEADER,
  controlPlaneFromEnv,
  createTenantResolver,
  normalizeHost,
  parseTenantRow,
  signWebhookBody,
  signedTenantHeaders,
  stripTenantHeaders,
  tenantAccess,
  tenantHeaderKey,
  verifyTenantHeaders,
  verifyWebhook,
} from "../src/lib/tenant/resolve.ts";
import { getTenantConfig, parsePublicTenantConfig, toPublicTenantConfig } from "../src/lib/tenant/config.ts";
import { getServerServiceRoleKey, getServerTenant } from "../src/lib/tenant/server.ts";
import { signedWebhookRequest } from "../control-panel/lib/erpWebhook.ts";

const CP = { url: "https://control.example.supabase.co", serviceRoleKey: "cp-service-key" };
const KEY = tenantHeaderKey(CP);
const ANON = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJlLXRoYXQtaXMtbG9uZw";

const acme = {
  tenantId: "0b5f2b52-6a0e-4a4e-9a49-000000000001",
  slug: "acme",
  status: "active",
  apiUrl: "https://acmeref.supabase.co",
  anonKey: ANON,
  serviceRoleKey: "acme-service",
};

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ── Host ─────────────────────────────────────────────────────────────────────

test("hosts are normalized: lower case, no port, no trailing dot; junk is rejected", () => {
  assert.equal(normalizeHost("Acme.Example.AZ:3000"), "acme.example.az");
  assert.equal(normalizeHost("acme.localhost."), "acme.localhost");
  assert.equal(normalizeHost("localhost:3000"), "localhost");
  for (const bad of [null, "", " ", "[::1]:3000", "acme..az", "-acme.az", "ac me.az", "acme.az/x", "a".repeat(254)]) {
    assert.equal(normalizeHost(bad), null, String(bad));
  }
});

// ── Status rules ─────────────────────────────────────────────────────────────

test("status rules: what each tenant status allows", () => {
  for (const status of ["trial", "active", "past_due"]) {
    for (const method of ["GET", "POST", "DELETE"]) {
      assert.deepEqual(tenantAccess(status, method), { kind: "allow", readOnly: false }, `${status} ${method}`);
    }
  }
  for (const method of ["GET", "HEAD", "OPTIONS", "get"]) {
    assert.deepEqual(tenantAccess("read_only", method), { kind: "allow", readOnly: true }, method);
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.deepEqual(tenantAccess("read_only", method), { kind: "read_only_blocked" }, method);
  }
  for (const method of ["GET", "POST"]) {
    assert.deepEqual(tenantAccess("suspended", method), { kind: "suspended" });
    assert.deepEqual(tenantAccess("cancelled", method), { kind: "suspended" });
    assert.deepEqual(tenantAccess("provisioning", method), { kind: "preparing" });
  }
  // Every status the control plane allows has a rule.
  for (const status of TENANT_STATUSES) assert.ok(tenantAccess(status, "GET"));
});

test("the ERP and the control panel know the same tenant statuses", async () => {
  const { TENANT_STATUSES: panel } = await import("../control-panel/lib/tenants.ts");
  assert.deepEqual([...TENANT_STATUSES], [...panel]);
});

// ── Signed headers ───────────────────────────────────────────────────────────

test("proxy headers round-trip and carry no service key", () => {
  const headers = new Headers(signedTenantHeaders(acme, KEY));
  assert.deepEqual(verifyTenantHeaders(headers, KEY), {
    tenantId: acme.tenantId, slug: "acme", status: "active", apiUrl: acme.apiUrl, anonKey: ANON,
  });
  for (const [, value] of headers) assert.ok(!value.includes("acme-service"), "service key leaked into a header");
});

test("forged or tampered tenant headers are rejected", () => {
  const good = signedTenantHeaders(acme, KEY);
  for (const field of ["id", "slug", "status", "url", "anonKey"]) {
    const h = new Headers(good);
    h.set(TENANT_HEADER[field], field === "status" ? "trial" : `${h.get(TENANT_HEADER[field])}x`);
    assert.equal(verifyTenantHeaders(h, KEY), null, `tampered ${field}`);
  }
  assert.equal(verifyTenantHeaders(new Headers(good), tenantHeaderKey({ ...CP, serviceRoleKey: "other" })), null);
  const unsigned = new Headers(good);
  unsigned.delete(TENANT_HEADER.signature);
  assert.equal(verifyTenantHeaders(unsigned, KEY), null);
  assert.equal(verifyTenantHeaders(new Headers(), KEY), null);
});

test("stripTenantHeaders removes every client-sent x-erp-tenant-* header", () => {
  const incoming = new Headers({ ...signedTenantHeaders(acme, KEY), cookie: "a=1", host: "acme.localhost" });
  const clean = stripTenantHeaders(incoming);
  for (const name of Object.values(TENANT_HEADER)) assert.equal(clean.get(name), null, name);
  assert.equal(clean.get("cookie"), "a=1");
});

// ── Webhook ──────────────────────────────────────────────────────────────────

test("webhook: valid signature and age only; the control panel's signer matches", () => {
  const now = 1_760_000_000_000;
  const { body, signature } = signedWebhookRequest(acme.tenantId, "s3cret", now);
  assert.equal(signature, signWebhookBody(body, "s3cret"));
  assert.equal(verifyWebhook(body, signature, "s3cret", now + 1_000), true);
  assert.equal(verifyWebhook(body, signature, "other", now), false);
  assert.equal(verifyWebhook(body.replace("tenant.changed", "tenant.changeX"), signature, "s3cret", now), false);
  assert.equal(verifyWebhook(body, signature, "s3cret", now + 6 * 60_000), false, "replayed after 5 minutes");
  assert.equal(verifyWebhook(body, null, "s3cret", now), false);
  assert.equal(verifyWebhook(body, signature, "", now), false);
});

// ── Control-plane rows ───────────────────────────────────────────────────────

test("control-plane rows are validated", () => {
  const row = { tenant_id: acme.tenantId, slug: "acme", status: "active", api_url: "https://acmeref.supabase.co/", anon_key: ANON, service_role_key: "k" };
  assert.equal(parseTenantRow(row, true).apiUrl, "https://acmeref.supabase.co");
  assert.equal(parseTenantRow({ ...row, status: "weird" }, true), null);
  assert.equal(parseTenantRow({ ...row, api_url: "http://evil.example" }, false), null);
  assert.equal(parseTenantRow({ ...row, api_url: "http://127.0.0.1:54321" }, true), null, "plain http in production");
  assert.equal(parseTenantRow({ ...row, api_url: "http://127.0.0.1:54321" }, false).apiUrl, "http://127.0.0.1:54321");
  assert.equal(parseTenantRow({ ...row, anon_key: "" }, true), null);
  // A tenant being prepared may have no database yet.
  assert.equal(parseTenantRow({ ...row, status: "provisioning", api_url: null, anon_key: null }, true).status, "provisioning");
});

// ── Cache ────────────────────────────────────────────────────────────────────

function fakeControlPlane(rowsByHost) {
  const calls = [];
  const fetch = async (url, init) => {
    const args = JSON.parse(init.body);
    calls.push({ url, args, auth: init.headers.Authorization });
    if (args.p_host === "down.localhost") return new Response("boom", { status: 500 });
    const row = args.p_host ? rowsByHost[args.p_host] : Object.values(rowsByHost).find((r) => r.tenant_id === args.p_tenant_id);
    return Response.json(row ? [row] : []);
  };
  return { fetch, calls };
}

const acmeRow = { tenant_id: acme.tenantId, slug: "acme", status: "active", api_url: acme.apiUrl, anon_key: ANON, service_role_key: "acme-service" };

test("lookups are cached for 60 s, then refreshed; clear() drops the cache", async () => {
  let clock = 0;
  const cp = fakeControlPlane({ "acme.localhost": acmeRow });
  const resolver = createTenantResolver({ controlPlane: CP, fetch: cp.fetch, production: false, now: () => clock });

  assert.equal((await resolver.byHost("acme.localhost")).slug, "acme");
  assert.equal((await resolver.byHost("acme.localhost")).slug, "acme");
  assert.equal(cp.calls.length, 1, "second lookup served from cache");
  assert.equal(cp.calls[0].url, `${CP.url}/rest/v1/rpc/erp_tenant_runtime`);
  assert.equal(cp.calls[0].auth, `Bearer ${CP.serviceRoleKey}`);

  // The service key for server code comes from the same cache entry.
  assert.equal((await resolver.byId(acme.tenantId)).serviceRoleKey, "acme-service");
  assert.equal(cp.calls.length, 1);

  clock = 60_001;
  await resolver.byHost("acme.localhost");
  assert.equal(cp.calls.length, 2, "refreshed after 60 s");

  resolver.clear();
  await resolver.byHost("acme.localhost");
  assert.equal(cp.calls.length, 3, "webhook clear forces a fresh lookup");
});

test("unknown hosts resolve to null (cached too); a failing control plane throws", async () => {
  const cp = fakeControlPlane({ "acme.localhost": acmeRow });
  const resolver = createTenantResolver({ controlPlane: CP, fetch: cp.fetch, production: false, now: () => 0 });
  assert.equal(await resolver.byHost("nobody.localhost"), null);
  assert.equal(await resolver.byHost("nobody.localhost"), null);
  assert.equal(cp.calls.length, 1);
  await assert.rejects(resolver.byHost("down.localhost"), /HTTP 500/);
});

test("two tenants on two hosts stay apart", async () => {
  const beta = { ...acmeRow, tenant_id: "0b5f2b52-6a0e-4a4e-9a49-000000000002", slug: "beta", api_url: "https://betaref.supabase.co", service_role_key: "beta-service" };
  const cp = fakeControlPlane({ "acme.localhost": acmeRow, "beta.localhost": beta });
  const resolver = createTenantResolver({ controlPlane: CP, fetch: cp.fetch, production: false, now: () => 0 });
  const [a, b] = await Promise.all([resolver.byHost("acme.localhost"), resolver.byHost("beta.localhost")]);
  assert.equal(a.apiUrl, "https://acmeref.supabase.co");
  assert.equal(b.apiUrl, "https://betaref.supabase.co");
  assert.equal((await resolver.byId(b.tenantId)).serviceRoleKey, "beta-service");
});

// ── Modes ────────────────────────────────────────────────────────────────────

const SINGLE_ENV = {
  CONTROL_PLANE_URL: undefined,
  CONTROL_PLANE_SERVICE_ROLE_KEY: undefined,
  NEXT_PUBLIC_SUPABASE_URL: "https://delgroups.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
  SUPABASE_SERVICE_ROLE_KEY: "del-service",
};

test("no control plane configured: single-tenant, exactly the env config as before", async () => {
  await withEnv(SINGLE_ENV, async () => {
    const forged = new Headers(signedTenantHeaders(acme, KEY));
    const tenant = getServerTenant(forged);
    assert.deepEqual(tenant.config, getTenantConfig(), "headers are ignored without a control plane");
    assert.equal(tenant.config.supabaseUrl, "https://delgroups.supabase.co");
    assert.equal(tenant.config.tenantId, "default");
    assert.equal(tenant.status, null);
    assert.equal(await getServerServiceRoleKey(tenant.config), "del-service");
  });
});

test("control plane configured: the tenant comes only from verified headers, never the env", async () => {
  await withEnv({ ...SINGLE_ENV, CONTROL_PLANE_URL: CP.url, CONTROL_PLANE_SERVICE_ROLE_KEY: CP.serviceRoleKey }, async () => {
    // No headers / forged headers: unresolved, not the Del Groups env project.
    assert.equal(getServerTenant(new Headers()).config.isConfigured, false);
    assert.equal(getTenantConfig().isConfigured, false, "config.ts never falls back to env on the server");
    const forged = new Headers(signedTenantHeaders(acme, "wrong-key"));
    assert.equal(getServerTenant(forged).config.isConfigured, false);

    const tenant = getServerTenant(new Headers(signedTenantHeaders({ ...acme, status: "read_only" }, KEY)));
    assert.equal(tenant.config.isConfigured, true);
    assert.equal(tenant.config.tenantId, acme.tenantId);
    assert.equal(tenant.config.supabaseUrl, acme.apiUrl);
    assert.equal(tenant.status, "read_only");

    // The service key comes from the control plane (here a fake resolver), not SUPABASE_SERVICE_ROLE_KEY.
    const cp = fakeControlPlane({ "acme.localhost": acmeRow });
    globalThis.__erpTenantResolver = {
      url: CP.url,
      resolver: createTenantResolver({ controlPlane: CP, fetch: cp.fetch, production: false }),
    };
    try {
      assert.equal(await getServerServiceRoleKey(tenant.config), "acme-service");
      assert.equal(await getServerServiceRoleKey(getServerTenant(new Headers()).config), "");
    } finally {
      delete globalThis.__erpTenantResolver;
    }
  });
});

test("controlPlaneFromEnv needs both values", () => {
  assert.equal(controlPlaneFromEnv({}), null);
  assert.equal(controlPlaneFromEnv({ CONTROL_PLANE_URL: CP.url }), null);
  assert.deepEqual(controlPlaneFromEnv({ CONTROL_PLANE_URL: `${CP.url}/`, CONTROL_PLANE_SERVICE_ROLE_KEY: " k " }), { url: CP.url, serviceRoleKey: "k" });
});

// ── Proxy coverage ───────────────────────────────────────────────────────────

test("the proxy runs on pages and /api (so tenant headers cannot be forged there), not on static files", () => {
  const source = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");
  const pattern = source.match(/matcher:\s*\[\s*"([^"]+)"/)[1].replace(/\\\\/g, "\\");
  const matches = (path) => new RegExp(`^${pattern}$`).test(path);
  for (const path of ["/", "/sales", "/api/users", "/api/public-config", "/tenant/suspended"]) assert.ok(matches(path), path);
  for (const path of ["/_next/static/chunk.js", "/_next/image", "/favicon.ico", "/logo.png"]) assert.ok(!matches(path), path);
});

test("browser config: single-tenant output unchanged; wider URLs only for control-plane tenants", async () => {
  await withEnv(SINGLE_ENV, async () => {
    assert.deepEqual(toPublicTenantConfig(getTenantConfig()), { url: "https://delgroups.supabase.co", anonKey: ANON });
  });
  const local = { url: "http://127.0.0.1:54321", anonKey: ANON };
  assert.equal(parsePublicTenantConfig(local), null, "no flag: only *.supabase.co, as before");
  assert.deepEqual(parsePublicTenantConfig({ ...local, controlPlane: true }), { ...local, controlPlane: true });
  assert.equal(parsePublicTenantConfig({ url: "https://example.com", anonKey: ANON }), null);
  await withEnv({ NODE_ENV: "production" }, async () => {
    assert.equal(parsePublicTenantConfig({ ...local, controlPlane: true }), null, "plain http never in production");
  });
});
