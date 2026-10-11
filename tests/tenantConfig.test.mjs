// SaaS phase 1: Supabase URL/keys are resolved at runtime per tenant, not inlined at build.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  DEFAULT_TENANT_ID,
  getTenantConfig,
  getTenantServiceRoleKey,
  parsePublicTenantConfig,
  publicConfigScript,
  PUBLIC_CONFIG_GLOBAL,
  resolveTenantConfigFromEnv,
  supabaseClientCredentials,
  toPublicTenantConfig,
} from "../src/lib/tenant/config.ts";

const URL_A = "https://aaaaaaaaaaaaaaaaaaaa.supabase.co";
const URL_B = "https://bbbbbbbbbbbbbbbbbbbb.supabase.co";
const KEY_A = `eyJ${"a".repeat(60)}`;
const KEY_B = `sb_publishable_${"b".repeat(30)}`;

const env = (url, key) => ({
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: key,
});

test("runtime env wins over build-time values", () => {
  const config = resolveTenantConfigFromEnv([env(URL_A, KEY_A), env(URL_B, KEY_B)]);
  assert.equal(config.supabaseUrl, URL_A);
  assert.equal(config.supabaseAnonKey, KEY_A);
  assert.equal(config.isConfigured, true);
  assert.equal(config.issue, null);
  assert.equal(config.tenantId, DEFAULT_TENANT_ID);
});

test("build-time values are the fallback when the runtime env lacks them", () => {
  const config = resolveTenantConfigFromEnv([{}, env(URL_B, KEY_B)]);
  assert.equal(config.supabaseUrl, URL_B);
  assert.equal(config.supabaseAnonKey, KEY_B);
});

test("each variable falls back on its own", () => {
  const config = resolveTenantConfigFromEnv([
    { NEXT_PUBLIC_SUPABASE_URL: URL_A },
    env(URL_B, KEY_B),
  ]);
  assert.equal(config.supabaseUrl, URL_A);
  assert.equal(config.supabaseAnonKey, KEY_B);
});

test("blank, padded and quoted values are cleaned", () => {
  const config = resolveTenantConfigFromEnv([
    env("   ", ""),
    env(` "${URL_A}/" `, `'${KEY_A}'`),
  ]);
  assert.equal(config.supabaseUrl, URL_A, "quotes and trailing slash removed");
  assert.equal(config.supabaseAnonKey, KEY_A);
});

test("issues: missing, bad url, bad key", () => {
  assert.equal(resolveTenantConfigFromEnv([{}]).issue, "missing");
  assert.equal(resolveTenantConfigFromEnv([env(URL_A, "")]).issue, "missing");

  const badUrl = resolveTenantConfigFromEnv([env("http://evil.example.com", KEY_A)]);
  assert.equal(badUrl.issue, "bad_url");
  assert.equal(badUrl.isConfigured, false);
  assert.equal(badUrl.supabaseUrl, "", "an invalid url is never handed to a client");
  assert.equal(badUrl.urlPreview, "http://evil.example.com");

  const badKey = resolveTenantConfigFromEnv([env(URL_A, "pk_publishable_clerk_key_1234567890")]);
  assert.equal(badKey.issue, "bad_key");
  assert.equal(badKey.supabaseAnonKey, "");
});

test("getTenantConfig reads process.env at call time and accepts a request or headers", () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, env(URL_A, KEY_A));
    const fromRequest = getTenantConfig(new Request("https://acme.example.com/sales"));
    assert.equal(fromRequest.supabaseUrl, URL_A);

    Object.assign(process.env, env(URL_B, KEY_B));
    const fromHeaders = getTenantConfig(new Headers({ host: "acme.example.com" }));
    assert.equal(fromHeaders.supabaseUrl, URL_B, "not cached from the first call");
    assert.equal(getTenantConfig().supabaseAnonKey, KEY_B);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test("public config exposes url and anon key only", () => {
  const config = resolveTenantConfigFromEnv([env(URL_A, KEY_A)]);
  assert.deepEqual(toPublicTenantConfig(config), { url: URL_A, anonKey: KEY_A });
  assert.equal(toPublicTenantConfig(resolveTenantConfigFromEnv([{}])), null);
});

test("client credentials fall back to a placeholder when unconfigured", () => {
  const { url, anonKey } = supabaseClientCredentials(resolveTenantConfigFromEnv([{}]));
  assert.equal(url, "https://placeholder.supabase.co");
  assert.ok(anonKey.startsWith("eyJ"));
});

test("service-role key comes from the server env only", () => {
  const tenant = resolveTenantConfigFromEnv([env(URL_A, KEY_A)]);
  assert.equal(getTenantServiceRoleKey(tenant, { SUPABASE_SERVICE_ROLE_KEY: ' "secret" ' }), "secret");
  assert.equal(getTenantServiceRoleKey(tenant, {}), "");
});

test("embedded script round-trips and cannot break out of the script tag", () => {
  const script = publicConfigScript({ url: URL_A, anonKey: KEY_A });
  const window = {};
  new Function("window", script)(window);
  assert.deepEqual(parsePublicTenantConfig(window[PUBLIC_CONFIG_GLOBAL]), { url: URL_A, anonKey: KEY_A });

  const hostile = publicConfigScript({ url: "</script><script>alert(1)</script>", anonKey: "x" });
  assert.ok(!hostile.includes("</script>"));
  assert.equal(publicConfigScript(null), `window.${PUBLIC_CONFIG_GLOBAL}=null;`);
});

test("parsePublicTenantConfig rejects anything that is not a valid config", () => {
  for (const value of [null, undefined, "x", {}, { url: URL_A }, { url: 1, anonKey: KEY_A },
    { url: "https://example.com", anonKey: KEY_A }, { url: URL_A, anonKey: "short" }]) {
    assert.equal(parsePublicTenantConfig(value), null, JSON.stringify(value));
  }
});

test("no file outside the tenant config reads NEXT_PUBLIC_SUPABASE_* directly", () => {
  const root = new URL("../src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const allowed = join("lib", "tenant", "config.ts");
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx|js|mjs)$/.test(name) && relative(root, path) !== allowed) {
        if (/process\.env\.NEXT_PUBLIC_SUPABASE_/.test(readFileSync(path, "utf8"))) {
          offenders.push(relative(root, path).split(sep).join("/"));
        }
      }
    }
  };
  walk(decodeURIComponent(root));
  assert.deepEqual(offenders, []);
});
