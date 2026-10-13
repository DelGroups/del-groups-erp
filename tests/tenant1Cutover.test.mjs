// Tenant #1 cutover (prompt 11): generated history SQL, read-only preflight, registration
// script without secrets, and the smoke test against a fake ERP + fake Supabase.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createServerClient } from "@supabase/ssr";
import { HISTORY_SQL_PATH, migrationHistorySql } from "../scripts/tenants/migration-history.ts";
import { compareFingerprints, runSmoke } from "../scripts/tenants/smoke.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SQL_DIR = path.join(ROOT, "supabase");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const code = (sql) => sql.replace(/--.*$/gm, "").replace(/'([^']|'')*'/g, "''").toLowerCase();

// ── SQL files ────────────────────────────────────────────────────────────────

test("the committed migration history SQL is up to date (npm run tenants:history-sql)", () => {
  assert.equal(readFileSync(HISTORY_SQL_PATH, "utf8").replace(/\r\n/g, "\n"), migrationHistorySql(SQL_DIR));
});

test("the history records exactly the migrations up to the baseline version", () => {
  const version = read("supabase/baseline/VERSION").trim();
  const sql = readFileSync(HISTORY_SQL_PATH, "utf8");
  const recorded = [...sql.matchAll(/\('(\d{14})', '([a-z0-9_]+)'\)/g)].map((m) => `${m[1]}_${m[2]}`);
  const expected = readdirSync(path.join(SQL_DIR, "migrations"))
    .map((f) => /^(\d{14}_[a-z0-9_]+)\.sql$/.exec(f)?.[1])
    .filter((n) => n && n.slice(0, 14) <= version)
    .sort();
  assert.deepEqual(recorded, expected);
  assert.ok(recorded.length > 100);
  assert.match(sql, /on conflict \(version\) do nothing/);
  assert.doesNotMatch(code(sql), /\b(update|delete|drop|truncate|alter)\b/);
});

test("the production preflight is a single read-only SELECT", () => {
  const sql = code(read("supabase/scripts/tenant1_preflight.sql"));
  assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|comment|vacuum|do)\b/);
  assert.equal(sql.split(";").filter((s) => s.trim()).length, 1);
  // Every post-baseline migration is covered.
  const version = read("supabase/baseline/VERSION").trim();
  const raw = read("supabase/scripts/tenant1_preflight.sql");
  for (const f of readdirSync(path.join(SQL_DIR, "migrations"))) {
    const m = /^(\d{14}_[a-z0-9_]+)\.sql$/.exec(f);
    if (m && m[1].slice(0, 14) > version) assert.ok(raw.includes(m[1]), `preflight does not look at ${m[1]}`);
  }
});

test("the registration script holds placeholders only, never a key", () => {
  const sql = read("control-panel/supabase/scripts/register_tenant_1.sql");
  for (const p of ["<YOUR PLATFORM ADMIN EMAIL>", "<ERP PROJECT REF>", "<ERP ANON OR PUBLISHABLE KEY>", "<ERP SERVICE ROLE OR SECRET KEY>"]) {
    assert.ok(sql.includes(p), p);
  }
  assert.doesNotMatch(sql, /eyJ[A-Za-z0-9_-]{10,}|sb_(secret|publishable)_[A-Za-z0-9]|sbp_[A-Za-z0-9]/);
  assert.match(sql, /raise exception 'fill in the four values/);
  assert.match(sql, /'del-groups',\s+-- slug/);
  assert.match(sql, /'erp\.del-groups\.com'\s+-- domain/);
  assert.match(sql, /values \(v_tenant, v_in\.domain, 'custom', true, 'active'\)/);
  assert.match(sql, /is_canary = false/);
});

// ── Smoke test ───────────────────────────────────────────────────────────────

const SITE = "https://erp.example.test";
const SUPA = "https://abcdefghijklmnopqrst.supabase.co";
const ANON = "anon-key-for-tests-not-real-000000";
const PASSWORD = "Pa55word-for-tests";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const ACCESS = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "11111111-1111-1111-1111-111111111111", exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated", aud: "authenticated" })}.sig`;
const REFRESH = "refresh-token-for-tests";

/** Fake ERP site + Supabase project. `over` replaces single routes. */
function world(over = {}) {
  const seen = [];
  const routes = {
    "GET /login": () => new Response("<html>login</html>", { status: 200 }),
    "GET /api/public-config": () => Response.json({ configured: true, url: SUPA, anonKey: ANON, controlPlane: true }),
    "POST /auth/v1/token": async (init) => {
      const body = JSON.parse(init.body);
      return body.password === PASSWORD
        ? Response.json({ access_token: ACCESS, refresh_token: REFRESH, token_type: "bearer", expires_in: 3600, user: { id: "u1" } })
        : Response.json({ error_description: "Invalid login credentials" }, { status: 400 });
    },
    "GET /auth/v1/user": () => Response.json({ id: "11111111-1111-1111-1111-111111111111", aud: "authenticated", role: "authenticated", email: "staff@example.test" }),
    "POST /auth/v1/logout": () => new Response(null, { status: 204 }),
    "GET /rest/v1/sales": () =>
      Response.json([{ id: "s-2", invoice_number: "INV-0002" }, { id: "s-1", invoice_number: "INV-0001" }], {
        headers: { "content-range": "0-1/42" },
      }),
    "GET /rest/v1/sale_items": () => Response.json([{ id: "i1" }, { id: "i2" }]),
    "GET /rest/v1/company_profile": () => Response.json([{ display_name: "DEL GROUPS MMC", legal_name: "DEL GROUPS MMC" }]),
    "GET /rest/v1/settings": () => Response.json([{ company_name: "Old Name" }]),
    "GET /rest/v1/warehouse_stocks": () => Response.json([{ current_stock: 10.5 }, { current_stock: "4" }]),
    "GET /rest/v1/tenant_modules": () => Response.json([{ enabled: true }, { enabled: true }, { enabled: false }]),
    "GET /sales": () => new Response("ok", { status: 200 }),
    "GET /sales/s-2": () => new Response("ok", { status: 200 }),
    "GET /inventory": () => new Response("ok", { status: 200 }),
    ...over,
  };
  const fetch = async (input, init = {}) => {
    const u = new URL(input);
    const key = `${(init.method ?? "GET").toUpperCase()} ${u.pathname}`;
    seen.push({ key, url: input, headers: new Headers(init.headers ?? {}) });
    const handler = routes[key];
    return handler ? handler(init) : new Response("not found", { status: 404 });
  };
  return { fetch, seen };
}

const run = (w, password = PASSWORD) => runSmoke({ baseUrl: `${SITE}/`, email: "staff@example.test", password, fetch: w.fetch });

test("smoke test: every check passes on a healthy site and the fingerprint is filled", async () => {
  const w = world();
  const r = await run(w);
  assert.equal(r.ok, true, JSON.stringify(r.checks, null, 2));
  assert.deepEqual(r.checks.map((c) => c.name), [
    "login page", "public config", "sign in", "sales list", "invoice print data", "stock levels", "modules",
    "page /sales", "page /sales/s-2", "page /inventory",
  ]);
  assert.deepEqual(r.fingerprint, {
    mode: "control-plane",
    supabaseHost: "abcdefghijklmnopqrst.supabase.co",
    salesCount: 42,
    newestSaleId: "s-2",
    stockRows: 2,
    stockTotal: 14.5,
    modulesEnabled: 2,
  });
  // Nothing secret in the output.
  const out = JSON.stringify(r);
  for (const s of [PASSWORD, ACCESS, REFRESH, ANON]) assert.ok(!out.includes(s), "secret in output");
  // Read-only: no write to the REST API; it signs out at the end.
  assert.ok(!w.seen.some((s) => /^(POST|PATCH|PUT|DELETE) \/rest\//.test(s.key)));
  assert.equal(w.seen.at(-1).key, "POST /auth/v1/logout");
});

test("smoke test: the pages get a session cookie @supabase/ssr itself can read back", async () => {
  const w = world();
  await run(w);
  const cookie = w.seen.find((s) => s.key === "GET /sales").headers.get("cookie");
  assert.match(cookie, /^sb-abcdefghijklmnopqrst-auth-token(\.\d+)?=/);
  const jar = cookie.split("; ").map((c) => ({ name: c.slice(0, c.indexOf("=")), value: c.slice(c.indexOf("=") + 1) }));
  const client = createServerClient(SUPA, ANON, { cookies: { getAll: () => jar, setAll: () => {} }, global: { fetch: w.fetch } });
  const { data } = await client.auth.getSession();
  assert.equal(data.session?.access_token, ACCESS);
});

test("smoke test: an unknown or suspended tenant stops at the login page", async () => {
  const r = await run(world({ "GET /login": () => new Response("not found", { status: 404 }) }));
  assert.equal(r.ok, false);
  assert.deepEqual(r.checks.map((c) => [c.name, c.ok, c.detail]), [["login page", false, "HTTP 404"]]);
  assert.equal(r.fingerprint, null);
});

test("smoke test: a wrong password fails without echoing it", async () => {
  const r = await run(world(), "wrong-password-123");
  assert.equal(r.ok, false);
  const signIn = r.checks.find((c) => c.name === "sign in");
  assert.match(signIn.detail, /HTTP 400 Invalid login credentials/);
  assert.ok(!JSON.stringify(r).includes("wrong-password-123"));
});

test("smoke test: before the company_profile migration the invoice header comes from settings", async () => {
  const r = await run(
    world({
      "GET /rest/v1/company_profile": () => Response.json({ code: "42P01", message: "relation does not exist" }, { status: 404 }),
      "GET /rest/v1/tenant_modules": () => Response.json({ code: "42P01" }, { status: 404 }),
      "GET /api/public-config": () => Response.json({ configured: true, url: SUPA, anonKey: ANON }),
    })
  );
  assert.equal(r.ok, true);
  assert.match(r.checks.find((c) => c.name === "invoice print data").detail, /header "Old Name"/);
  assert.match(r.checks.find((c) => c.name === "modules").detail, /not installed yet/);
  assert.equal(r.fingerprint.mode, "single-tenant");
  assert.equal(r.fingerprint.modulesEnabled, null);
});

test("smoke test: a page that bounces to /login or an API error fails the run", async () => {
  const r = await run(
    world({
      "GET /inventory": () => new Response(null, { status: 307, headers: { location: `${SITE}/login` } }),
      "GET /rest/v1/warehouse_stocks": () => Response.json({ message: "permission denied" }, { status: 403 }),
    })
  );
  assert.equal(r.ok, false);
  assert.deepEqual(
    r.checks.filter((c) => !c.ok).map((c) => [c.name, c.detail]),
    [["stock levels", 'warehouse_stocks: HTTP 403 {"message":"permission denied"}'], ["page /inventory", "HTTP 307 -> /login"]]
  );
});

test("fingerprints: same project and nothing lost passes; another project or fewer sales fails", () => {
  const before = { mode: "single-tenant", supabaseHost: "a.supabase.co", salesCount: 10, newestSaleId: "x", stockRows: 5, stockTotal: 7, modulesEnabled: null };
  const ok = compareFingerprints(before, { ...before, mode: "control-plane", salesCount: 11, modulesEnabled: 18 });
  assert.ok(ok.every((c) => c.ok), JSON.stringify(ok));
  assert.match(ok.find((c) => c.name === "mode").detail, /single-tenant -> control-plane/);
  const bad = compareFingerprints(before, { ...before, supabaseHost: "b.supabase.co", salesCount: 9 });
  assert.deepEqual(bad.filter((c) => !c.ok).map((c) => c.name), ["same Supabase project", "sales not lost"]);
});

// ── Container healthcheck ────────────────────────────────────────────────────

test("the healthcheck names a tenant domain only when ERP_HEALTHCHECK_HOST is set; unset it is today's request", () => {
  const docker = read("Dockerfile");
  const check = docker.slice(docker.indexOf("HEALTHCHECK"));
  assert.match(check, /--header "Host: \$\{ERP_HEALTHCHECK_HOST:-127\.0\.0\.1:3000\}" http:\/\/127\.0\.0\.1:3000\/login/);
  assert.match(check, /CMD wget -qO- /, "shell form, so the variable is expanded in the container");
});
