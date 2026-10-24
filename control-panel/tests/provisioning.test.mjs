// Provisioning (prompt 9): plan, Management API client, email templates and the step engine.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PROVISIONING_STEPS, parseProvisioningOptions } from "../lib/provisioning/steps.ts";
import { expectedBuckets, moduleClosure, schemaFiles, tenantModulesSql, baselineVersion } from "../lib/provisioning/plan.ts";
import { createManagementApi, pickKeys, redactSecrets } from "../lib/provisioning/managementApi.ts";
import { authEmailConfig } from "../lib/provisioning/emails.ts";
import { advanceJob, retryJob } from "../lib/provisioning/engine.ts";
import { provisioningConfigFromEnv } from "../lib/provisioning/config.ts";

const SQL_DIR = fileURLToPath(new URL("../../supabase/", import.meta.url));
// Not a real token (and not in the shape of one, so secret scanners stay quiet).
const TOKEN = "test-management-token-not-real-0001";

// The module rows the control-plane migration seeds (id, depends).
const MODULES = [
  ["core", []], ["accounting", ["core"]], ["inventory", ["core"]], ["contracts", ["core"]],
  ["sales", ["core", "inventory", "accounting", "contracts"]], ["purchases", ["core", "inventory", "accounting", "contracts"]],
  ["polywood", ["core", "inventory", "sales"]], ["production", ["core", "inventory"]], ["expenses", ["core", "accounting"]],
  ["hr", ["core"]], ["tax-az", ["core", "accounting"]], ["payroll", ["core", "hr", "accounting", "tax-az"]],
  ["crm", ["core", "sales"]], ["consignment", ["core", "inventory", "sales"]], ["commissions", ["core", "hr", "sales"]],
  ["barcode", ["core", "inventory"]], ["ai", ["core"]], ["studio", ["core"]],
].map(([id, depends]) => ({ id, depends }));
const MODULE_IDS = MODULES.map((m) => m.id);

// ── Options ──────────────────────────────────────────────────────────────────

test("the provisioning form is validated; core is always included", () => {
  const ok = parseProvisioningOptions({ modules: ["crm"], adminEmail: " Boss@Acme.AZ ", adminName: "Boss", finalStatus: "active" }, MODULE_IDS);
  assert.deepEqual(ok, { ok: true, value: { modules: ["core", "crm"], adminEmail: "boss@acme.az", adminName: "Boss", finalStatus: "active" } });
  assert.equal(parseProvisioningOptions({ modules: [], adminEmail: "a@b.c", adminName: "A" }, MODULE_IDS).value.finalStatus, "trial");
  const bad = parseProvisioningOptions({ modules: ["nope"], adminEmail: "x", adminName: " ", finalStatus: "suspended" }, MODULE_IDS);
  assert.deepEqual(bad.errors, { modules: "modulesUnknown", adminEmail: "emailInvalid", adminName: "nameRequired", finalStatus: "statusInvalid" });
});

// ── Plan ─────────────────────────────────────────────────────────────────────

test("chosen modules are closed over their dependencies", () => {
  assert.deepEqual(moduleClosure(["crm"], MODULES), ["core", "accounting", "inventory", "contracts", "sales", "crm"]);
  assert.deepEqual(moduleClosure([], MODULES), ["core"]);
  assert.deepEqual(moduleClosure(["payroll", "unknown"], MODULES), ["core", "accounting", "hr", "tax-az", "payroll"]);
});

test("schema files: core baseline, then the modules' install scripts in ORDER, then newer migrations", () => {
  const files = schemaFiles(SQL_DIR, moduleClosure(["crm"], MODULES));
  const names = files.map((f) => f.name);
  assert.deepEqual(names.slice(0, 14), [
    "baseline_00_extensions", "baseline_01_types", "baseline_02_sequences", "baseline_03_tables", "baseline_04_functions",
    "baseline_05_defaults", "baseline_06_constraints", "baseline_07_indexes", "baseline_08_views", "baseline_09_triggers",
    "baseline_10_rls_policies", "baseline_11_grants", "baseline_12_storage_realtime", "baseline_13_seed",
  ]);
  const order = readFileSync(path.join(SQL_DIR, "modules", "ORDER"), "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const moduleFiles = names.filter((n) => n.startsWith("module_"));
  const expected = order.filter((id) => ["accounting", "inventory", "contracts", "sales", "crm"].includes(id)).map((id) => `module_${id}`);
  assert.deepEqual(moduleFiles, expected);
  assert.ok(!names.includes("module_production"));
  const version = baselineVersion(SQL_DIR);
  const migrations = names.filter((n) => /^\d{14}_/.test(n));
  assert.ok(migrations.length > 0);
  for (const m of migrations) assert.ok(m.slice(0, 14) > version, m);
  assert.deepEqual(migrations, [...migrations].sort());
  assert.ok(names.indexOf(migrations[0]) > names.indexOf(moduleFiles.at(-1)), "migrations come last");
});

test("expected storage buckets are read from the files", () => {
  const all = expectedBuckets(schemaFiles(SQL_DIR, MODULE_IDS));
  for (const b of ["ai-assistant", "crm-assets", "product-images", "contract-attachments", "expense-attachments"]) assert.ok(all.includes(b), b);
  assert.ok(!expectedBuckets(schemaFiles(SQL_DIR, ["core"])).includes("contract-attachments"));
});

test("tenant_modules SQL enables exactly the chosen modules", () => {
  const sql = tenantModulesSql(["core", "sales", "crm", "hr"], ["core", "sales"]);
  assert.match(sql, /\('core', true\)/);
  assert.match(sql, /\('sales', true\)/);
  assert.match(sql, /\('crm', false\)/);
  assert.match(sql, /\('hr', false\)/);
  assert.match(sql, /on conflict \(module_id\) do update set enabled = excluded\.enabled/);
  assert.doesNotMatch(tenantModulesSql(["x'); drop table t; --"], []), /drop table/);
});

// ── Management API ───────────────────────────────────────────────────────────

function recordingFetch(handler) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const { status = 200, body = {} } = (await handler(url, init)) ?? {};
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  return { fetch, calls };
}

test("Management API requests: EU smart region, organization slug, bearer token", async () => {
  const rec = recordingFetch(() => ({ status: 201, body: { ref: "abcdefghijklmnopqrst", name: "erp-acme", region: "eu-central-1", status: "COMING_UP" } }));
  const api = createManagementApi({ token: TOKEN, fetch: rec.fetch });
  const project = await api.createProject({ name: "erp-acme", organizationSlug: "del-groups", dbPass: "pw", regionGroup: "emea" });
  assert.equal(project.ref, "abcdefghijklmnopqrst");
  assert.equal(rec.calls[0].url, "https://api.supabase.com/v1/projects");
  assert.equal(rec.calls[0].method, "POST");
  assert.equal(rec.calls[0].headers.Authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(rec.calls[0].body, {
    name: "erp-acme", organization_slug: "del-groups", db_pass: "pw", region_selection: { type: "smartGroup", code: "emea" },
  });

  await api.applyMigration("ref1", "baseline_00_extensions", "select 1;");
  assert.equal(rec.calls[1].url, "https://api.supabase.com/v1/projects/ref1/database/migrations");
  assert.deepEqual(rec.calls[1].body, { name: "baseline_00_extensions", query: "select 1;" });

  await api.updateAuthConfig("ref1", { site_url: "https://acme.erp.test" });
  assert.equal(rec.calls[2].method, "PATCH");
  assert.equal(rec.calls[2].url, "https://api.supabase.com/v1/projects/ref1/config/auth");
});

test("Management API errors never contain the token or keys", async () => {
  const rec = recordingFetch(() => ({ status: 400, body: `bad request for ${TOKEN} key eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2lnbmF0dXJl` }));
  const api = createManagementApi({ token: TOKEN, fetch: rec.fetch });
  await assert.rejects(api.listProjects(), (error) => {
    assert.match(error.message, /HTTP 400/);
    assert.ok(!error.message.includes(TOKEN));
    assert.ok(!error.message.includes("eyJhbGci"));
    return true;
  });
  assert.equal(redactSecrets("token sb_secret_abc123 and sb_publishable_xyz"), "token [redacted] and [redacted]");
  assert.equal(redactSecrets("pat sbp_abc123 here"), "pat [redacted] here");
});

test("API keys: publishable/secret preferred, legacy anon/service_role otherwise", () => {
  assert.deepEqual(
    pickKeys([
      { name: "anon", type: "legacy", api_key: "eyJanon" },
      { name: "service_role", type: "legacy", api_key: "eyJservice" },
      { name: "default", type: "publishable", api_key: "sb_publishable_x" },
      { name: "default", type: "secret", api_key: "sb_secret_y" },
    ]),
    { anonKey: "sb_publishable_x", serviceRoleKey: "sb_secret_y", kind: "publishable/secret" }
  );
  assert.deepEqual(
    pickKeys([{ name: "anon", type: "legacy", api_key: "eyJanon" }, { name: "service_role", type: "legacy", api_key: "eyJservice" }]),
    { anonKey: "eyJanon", serviceRoleKey: "eyJservice", kind: "legacy" }
  );
  assert.throws(() => pickKeys([]), /no usable API keys/);
});

// ── Email templates ──────────────────────────────────────────────────────────

test("auth emails are in the tenant's language, with the company name escaped", () => {
  for (const lang of ["az", "en", "ru"]) {
    const cfg = authEmailConfig(lang, "Acme <MMC>");
    assert.ok(cfg.mailer_subjects_invite.includes("Acme <MMC>"), lang);
    assert.ok(cfg.mailer_templates_invite_content.includes("{{ .ConfirmationURL }}"), lang);
    assert.ok(cfg.mailer_templates_invite_content.includes("Acme &lt;MMC&gt;"), lang);
    assert.ok(!cfg.mailer_templates_invite_content.includes("<MMC>"), lang);
    assert.ok(cfg.mailer_templates_recovery_content.includes("{{ .ConfirmationURL }}"), lang);
  }
  assert.notEqual(authEmailConfig("az", "X").mailer_subjects_invite, authEmailConfig("ru", "X").mailer_subjects_invite);
});

test("provisioning config needs token, organization and base domain; EU by default", () => {
  const { config, missing } = provisioningConfigFromEnv({}, "/repo/control-panel");
  assert.equal(config, null);
  assert.deepEqual(missing, ["SUPABASE_MANAGEMENT_API_TOKEN", "SUPABASE_ORG_SLUG", "TENANT_BASE_DOMAIN"]);
  const ok = provisioningConfigFromEnv(
    { SUPABASE_MANAGEMENT_API_TOKEN: TOKEN, SUPABASE_ORG_SLUG: "del", TENANT_BASE_DOMAIN: ".ERP.Example.com." },
    "/repo/control-panel"
  ).config;
  assert.equal(ok.regionGroup, "emea");
  assert.equal(ok.baseDomain, "erp.example.com");
  assert.equal(ok.sqlDir, path.resolve("/repo/control-panel", "..", "supabase"));
});

// ── Engine ───────────────────────────────────────────────────────────────────

/** In-memory control plane for one job. */
function memoryStore(options) {
  const job = {
    id: "job-1",
    status: "running",
    options,
    currentStep: null,
    tenant: { id: "tenant-1", slug: "acme", name: "Acme MMC", language: "az" },
    steps: PROVISIONING_STEPS.map((step, position) => ({
      step, position, status: "pending", attempts: 0, output: {}, error: null, startedAt: null, finishedAt: null,
    })),
  };
  const state = { job, log: [], secrets: {}, database: {}, domains: [], tenantStatus: "provisioning", locked: false };
  const store = {
    state,
    async claim() {
      if (state.locked) return false;
      state.locked = true;
      return true;
    },
    async release() {
      state.locked = false;
    },
    async load() {
      return structuredClone(job);
    },
    async updateStep(_id, step, patch) {
      Object.assign(job.steps.find((s) => s.step === step), patch);
    },
    async updateJob(_id, patch) {
      if (patch.status !== undefined) job.status = patch.status;
      if (patch.currentStep !== undefined) job.currentStep = patch.currentStep;
    },
    async log(_id, step, level, message) {
      state.log.push({ step, level, message });
    },
    async setSecret(_tenant, name, value) {
      state.secrets[name] = value;
    },
    async upsertDatabase(_tenant, patch) {
      Object.assign(state.database, patch);
    },
    async ensurePrimaryDomain(_tenant, domain) {
      if (!state.domains.includes(domain)) state.domains.push(domain);
    },
    async setTenantStatus(_tenant, status) {
      state.tenantStatus = status;
    },
    async listModules() {
      return MODULES;
    },
  };
  return store;
}

function fakeApi({ healthyAfter = 2, failMigrationAt = null } = {}) {
  const calls = { create: 0, health: 0, migrations: [], queries: [], auth: [] };
  let created = null;
  return {
    calls,
    async listProjects() {
      return created ? [created] : [];
    },
    async createProject(input) {
      calls.create++;
      created = { ref: "acmeprojectref000001", name: input.name, region: "eu-central-1", status: "COMING_UP" };
      return created;
    },
    async getHealth(_ref, services) {
      calls.health++;
      const healthy = calls.health >= healthyAfter;
      return services.map((name) => ({ name, status: healthy ? "ACTIVE_HEALTHY" : "COMING_UP", healthy }));
    },
    async getKeys() {
      return { anonKey: "sb_publishable_tenantanon", serviceRoleKey: "sb_secret_tenantservice", kind: "publishable/secret" };
    },
    async applyMigration(_ref, name) {
      if (failMigrationAt !== null && calls.migrations.length === failMigrationAt && !this.failedOnce) {
        this.failedOnce = true;
        throw new Error(`migration ${name} failed: syntax error near ${TOKEN}`);
      }
      calls.migrations.push(name);
    },
    async runQuery(_ref, query) {
      calls.queries.push(query);
      if (query.startsWith("select id from storage.buckets")) {
        return ["ai-assistant", "chatter-attachments", "contract-attachments", "crm-assets", "product-images"].map((id) => ({ id }));
      }
      return [];
    },
    async updateAuthConfig(_ref, config) {
      calls.auth.push(config);
    },
  };
}

function deps(store, api, invites = []) {
  return {
    store,
    api,
    auth: {
      async inviteAdmin(input) {
        invites.push(input);
        return "invited";
      },
    },
    config: { managementToken: TOKEN, organizationSlug: "del-groups", regionGroup: "emea", baseDomain: "erp.test", sqlDir: SQL_DIR },
    readFile: (p) => readFileSync(p, "utf8"),
    randomPassword: () => "generated-db-password-0001",
    now: () => Date.parse("2026-10-12T10:00:00Z"),
  };
}

async function runToEnd(d, limit = 200) {
  const results = [];
  for (let i = 0; i < limit; i++) {
    const result = await advanceJob(d, "job-1");
    results.push(result);
    if (result === "done" || result === "failed") return results;
  }
  throw new Error("did not finish");
}

const OPTIONS = { modules: ["core", "crm"], adminEmail: "boss@acme.az", adminName: "Boss", finalStatus: "trial" };

test("a job runs every step in order and ends with a working tenant record", async () => {
  const store = memoryStore(OPTIONS);
  const api = fakeApi({ healthyAfter: 3 });
  const invites = [];
  const results = await runToEnd(deps(store, api, invites));

  assert.equal(results.at(-1), "done");
  assert.equal(results.filter((r) => r === "waiting").length, 2, "waited twice for health");
  assert.equal(store.state.job.status, "succeeded");
  assert.ok(store.state.job.steps.every((s) => s.status === "succeeded"));
  assert.equal(api.calls.create, 1);

  // Schema: every file, one per call, recorded with the baseline version.
  const files = schemaFiles(SQL_DIR, moduleClosure(OPTIONS.modules, MODULES)).map((f) => f.name);
  assert.deepEqual(api.calls.migrations, files);
  assert.equal(store.state.database.schema_version, baselineVersion(SQL_DIR));
  assert.equal(store.state.database.last_migration, files.at(-1));
  assert.equal(store.state.database.supabase_project_ref, "acmeprojectref000001");

  // Auth, modules, domain, admin, status.
  assert.equal(api.calls.auth[0].site_url, "https://acme.erp.test");
  assert.equal(api.calls.auth[0].uri_allow_list, "https://acme.erp.test/**");
  assert.equal(api.calls.auth[0].disable_signup, true);
  const seed = api.calls.queries.find((q) => q.includes("tenant_modules"));
  assert.match(seed, /\('crm', true\)/);
  assert.match(seed, /\('production', false\)/);
  assert.deepEqual(store.state.domains, ["acme.erp.test"]);
  assert.equal(invites.length, 1);
  assert.deepEqual(
    { email: invites[0].email, apiUrl: invites[0].apiUrl, redirectTo: invites[0].redirectTo },
    { email: "boss@acme.az", apiUrl: "https://acmeprojectref000001.supabase.co", redirectTo: "https://acme.erp.test/auth/set-password" }
  );
  assert.equal(store.state.tenantStatus, "trial");

  // Secrets only in Vault: never in step output or the log.
  assert.deepEqual(Object.keys(store.state.secrets).sort(), ["db_password", "supabase_anon_key", "supabase_service_role_key"]);
  const visible = JSON.stringify({ steps: store.state.job.steps, log: store.state.log });
  for (const secret of ["generated-db-password-0001", "sb_publishable_tenantanon", "sb_secret_tenantservice", TOKEN]) {
    assert.ok(!visible.includes(secret), `leaked ${secret.slice(0, 12)}`);
  }
});

test("a failed step stops the job; retry resumes at the same schema file", async () => {
  const store = memoryStore(OPTIONS);
  const api = fakeApi({ healthyAfter: 1, failMigrationAt: 5 });
  const d = deps(store, api);
  const first = await runToEnd(d);
  assert.equal(first.at(-1), "failed");
  const schema = store.state.job.steps.find((s) => s.step === "apply_schema");
  assert.equal(schema.status, "failed");
  assert.equal(schema.output.applied, 5);
  assert.match(schema.error, /failed: syntax error/);
  assert.ok(!schema.error.includes(TOKEN), "token redacted from the stored error");
  assert.equal(store.state.job.status, "failed");
  assert.equal(await advanceJob(d, "job-1"), "failed", "nothing runs until retry");

  assert.equal(await retryJob(store, "job-1"), true);
  const second = await runToEnd(d);
  assert.equal(second.at(-1), "done");
  const files = schemaFiles(SQL_DIR, moduleClosure(OPTIONS.modules, MODULES)).map((f) => f.name);
  assert.deepEqual(api.calls.migrations, files, "each file applied once, in order");
  assert.equal(store.state.job.steps.find((s) => s.step === "apply_schema").attempts, 2);
});

test("create_project reuses a project an interrupted attempt already created", async () => {
  const store = memoryStore(OPTIONS);
  const api = fakeApi();
  await api.createProject({ name: "erp-acme" });
  api.calls.create = 0;
  await advanceJob(deps(store, api), "job-1");
  assert.equal(api.calls.create, 0, "no second project");
  assert.equal(store.state.job.steps[0].output.project_ref, "acmeprojectref000001");
  assert.equal(store.state.secrets.db_password, undefined, "no new password for a found project");
});

test("only one tab advances a job at a time", async () => {
  const store = memoryStore(OPTIONS);
  store.state.locked = true;
  assert.equal(await advanceJob(deps(store, fakeApi()), "job-1"), "busy");
  assert.equal(store.state.job.steps[0].status, "pending");
});
