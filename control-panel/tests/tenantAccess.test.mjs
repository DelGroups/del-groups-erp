// SAAS-2: custom SMTP for tenant projects, "Re-apply email settings" and "Copy invite link".
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { PROVISIONING_STEPS } from "../lib/provisioning/steps.ts";
import { redactSecrets } from "../lib/provisioning/managementApi.ts";
import { createManagementApi, DEFAULT_LINK_LIFETIME_SECONDS } from "../lib/provisioning/managementApi.ts";
import { describeEmailSetup, smtpAuthConfig, smtpSecrets, tenantSmtpFromEnv, TENANT_EMAIL_RATE_PER_HOUR } from "../lib/provisioning/smtp.ts";
import { provisioningConfigFromEnv } from "../lib/provisioning/config.ts";
import { advanceJob } from "../lib/provisioning/engine.ts";
import { createAdminLink, reapplyEmailSettings, tenantSiteUrl } from "../lib/provisioning/tenantAccess.ts";
import { createTenantAuth } from "../lib/provisioning/tenantAuth.ts";

const SQL_DIR = fileURLToPath(new URL("../../supabase/", import.meta.url));
// Not real secrets (and not in the shape of real ones, so secret scanners stay quiet).
const TOKEN = "test-management-token-not-real-0002";
const SMTP_PASS = "test-smtp-password-not-real-0003";
const SERVICE_KEY = "test-tenant-service-key-not-real-0004";

const SMTP_ENV = {
  TENANT_SMTP_HOST: "smtp.resend.com",
  TENANT_SMTP_PORT: "465",
  TENANT_SMTP_USER: "resend",
  TENANT_SMTP_PASS: SMTP_PASS,
  TENANT_SMTP_SENDER_EMAIL: "no-reply@del-groups.com",
};
const BASE_ENV = { SUPABASE_MANAGEMENT_API_TOKEN: TOKEN, SUPABASE_ORG_SLUG: "del", TENANT_BASE_DOMAIN: "erp.test" };

function config(withSmtp = true) {
  return provisioningConfigFromEnv({ ...BASE_ENV, ...(withSmtp ? SMTP_ENV : {}), ERP_SQL_DIR: SQL_DIR }, "/repo/control-panel").config;
}

// ── SMTP settings ────────────────────────────────────────────────────────────

test("SMTP: unset means Supabase's default email; complete settings are read", () => {
  assert.deepEqual(tenantSmtpFromEnv({}), { smtp: null, missing: [] });
  const { smtp, missing } = tenantSmtpFromEnv({ ...SMTP_ENV, TENANT_SMTP_SENDER_NAME: " Del Groups " });
  assert.deepEqual(missing, []);
  assert.deepEqual(smtp, {
    host: "smtp.resend.com",
    port: 465,
    user: "resend",
    pass: SMTP_PASS,
    senderEmail: "no-reply@del-groups.com",
    senderName: "Del Groups",
  });
});

test("SMTP: half-filled or invalid settings are reported and block provisioning", () => {
  assert.deepEqual(tenantSmtpFromEnv({ TENANT_SMTP_HOST: "smtp.resend.com" }).missing, [
    "TENANT_SMTP_PORT", "TENANT_SMTP_USER", "TENANT_SMTP_PASS", "TENANT_SMTP_SENDER_EMAIL",
  ]);
  assert.deepEqual(tenantSmtpFromEnv({ ...SMTP_ENV, TENANT_SMTP_PORT: "70000" }).missing, ["TENANT_SMTP_PORT"]);
  assert.deepEqual(tenantSmtpFromEnv({ ...SMTP_ENV, TENANT_SMTP_SENDER_EMAIL: "not-an-email" }).missing, ["TENANT_SMTP_SENDER_EMAIL"]);

  const blocked = provisioningConfigFromEnv({ ...BASE_ENV, TENANT_SMTP_PASS: SMTP_PASS }, "/repo/control-panel");
  assert.equal(blocked.config, null);
  assert.ok(blocked.missing.includes("TENANT_SMTP_HOST"));
  assert.equal(config(false).smtp, null);
  assert.equal(config(true).smtp.host, "smtp.resend.com");
});

test("SMTP: the Management API fields, with a string port, a rate limit and a default sender name", () => {
  const { smtp } = tenantSmtpFromEnv(SMTP_ENV);
  assert.deepEqual(smtpAuthConfig(smtp, "Acme MMC"), {
    smtp_host: "smtp.resend.com",
    smtp_port: "465",
    smtp_user: "resend",
    smtp_pass: SMTP_PASS,
    smtp_admin_email: "no-reply@del-groups.com",
    smtp_sender_name: "Acme MMC ERP",
    rate_limit_email_sent: TENANT_EMAIL_RATE_PER_HOUR,
  });
  assert.equal(smtpAuthConfig({ ...smtp, senderName: "Del Groups" }, "Acme").smtp_sender_name, "Del Groups");
  assert.deepEqual(smtpSecrets(smtp), [SMTP_PASS]);
  assert.deepEqual(smtpSecrets(null), []);
  assert.ok(!describeEmailSetup(smtp).includes(SMTP_PASS));
  assert.equal(describeEmailSetup(null).includes("default"), true);
});

test("redaction removes the SMTP password, Resend keys and one-time link tokens", () => {
  const text = `PATCH failed: {"smtp_pass":"${SMTP_PASS}"} key re_AbCdEf123456789 ` +
    "https://x.supabase.co/auth/v1/verify?token=abc123secret&type=invite&redirect_to=https://acme.erp.test";
  const out = redactSecrets(text, [SMTP_PASS]);
  assert.ok(!out.includes(SMTP_PASS));
  assert.ok(!out.includes("re_AbCdEf123456789"));
  assert.ok(!out.includes("abc123secret"));
  assert.match(out, /token=\[redacted\]&type=invite/);
  assert.equal(redactSecrets('{"smtp_pass":"short"}'), '{"smtp_pass":"[redacted]"}');
});

// ── configure_auth ───────────────────────────────────────────────────────────

function jobAtConfigureAuth(cfgStepFails) {
  const job = {
    id: "job-1",
    status: "running",
    options: { modules: ["core"], adminEmail: "boss@acme.az", adminName: "Boss", finalStatus: "trial" },
    currentStep: null,
    tenant: { id: "tenant-1", slug: "acme", name: "Acme MMC", language: "en" },
    steps: PROVISIONING_STEPS.map((step, position) => ({
      step,
      position,
      status: PROVISIONING_STEPS.indexOf(step) < PROVISIONING_STEPS.indexOf("configure_auth") ? "succeeded" : "pending",
      attempts: 0,
      output: step === "create_project" ? { project_ref: "acmeprojectref000001" } : {},
      error: null,
      startedAt: null,
      finishedAt: null,
    })),
  };
  const log = [];
  const sent = [];
  const store = {
    async claim() { return true; },
    async release() {},
    async load() { return structuredClone(job); },
    async updateStep(_id, step, patch) { Object.assign(job.steps.find((s) => s.step === step), patch); },
    async updateJob(_id, patch) { if (patch.status) job.status = patch.status; },
    async log(_id, step, level, message) { log.push({ step, level, message }); },
  };
  const api = {
    async updateAuthConfig(ref, body) {
      sent.push({ ref, body });
      if (cfgStepFails) throw new Error(`HTTP 400 invalid smtp settings ${JSON.stringify(body)}`);
    },
  };
  return { job, log, sent, store, api };
}

test("configure_auth sends the SMTP settings and never logs the password", async () => {
  const run = jobAtConfigureAuth(false);
  const result = await advanceJob({ store: run.store, api: run.api, auth: {}, config: config(true), now: () => 0 }, "job-1");
  assert.equal(result, "progress");
  assert.equal(run.sent.length, 1);
  assert.equal(run.sent[0].ref, "acmeprojectref000001");
  assert.equal(run.sent[0].body.site_url, "https://acme.erp.test");
  assert.equal(run.sent[0].body.smtp_host, "smtp.resend.com");
  assert.equal(run.sent[0].body.smtp_pass, SMTP_PASS);
  assert.equal(run.sent[0].body.disable_signup, true);
  const visible = JSON.stringify({ steps: run.job.steps, log: run.log });
  assert.ok(!visible.includes(SMTP_PASS));
  assert.match(visible, /emails via smtp\.resend\.com:465/);
});

test("configure_auth without SMTP keeps today's settings", async () => {
  const run = jobAtConfigureAuth(false);
  await advanceJob({ store: run.store, api: run.api, auth: {}, config: config(false), now: () => 0 }, "job-1");
  assert.ok(!Object.keys(run.sent[0].body).some((k) => k.startsWith("smtp_")));
  assert.equal(run.sent[0].body.rate_limit_email_sent, undefined);
});

test("a failed configure_auth stores an error without the SMTP password", async () => {
  const run = jobAtConfigureAuth(true);
  const result = await advanceJob({ store: run.store, api: run.api, auth: {}, config: config(true), now: () => 0 }, "job-1");
  assert.equal(result, "failed");
  const visible = JSON.stringify({ steps: run.job.steps, log: run.log });
  assert.match(visible, /invalid smtp settings/);
  assert.ok(!visible.includes(SMTP_PASS));
});

// ── Re-apply email settings ──────────────────────────────────────────────────

const TENANT = { name: "Acme MMC", slug: "acme", status: "trial", language: "az", projectRef: "acmeprojectref000001", primaryDomain: null };

test("re-apply sends the same auth config to the tenant's project, on its primary domain", async () => {
  const sent = [];
  const api = { async updateAuthConfig(ref, body) { sent.push({ ref, body }); } };
  const result = await reapplyEmailSettings({ api, config: config(true) }, { ...TENANT, primaryDomain: "erp.acme.az" });
  assert.deepEqual(result, { ok: true, value: { customSmtp: true, siteUrl: "https://erp.acme.az" } });
  assert.equal(sent[0].ref, "acmeprojectref000001");
  assert.equal(sent[0].body.site_url, "https://erp.acme.az");
  assert.equal(sent[0].body.smtp_admin_email, "no-reply@del-groups.com");
  assert.equal(sent[0].body.mailer_subjects_invite.includes("Acme MMC"), true);

  assert.deepEqual(await reapplyEmailSettings({ api, config: config(true) }, { ...TENANT, projectRef: null }), { ok: false, error: "notProvisioned" });
  const failing = { async updateAuthConfig() { throw new Error(`HTTP 500 echo ${SMTP_PASS} ${TOKEN}`); } };
  const failed = await reapplyEmailSettings({ api: failing, config: config(true) }, TENANT);
  assert.equal(failed.ok, false);
  assert.ok(!failed.detail.includes(SMTP_PASS) && !failed.detail.includes(TOKEN));
});

// ── Copy invite link ─────────────────────────────────────────────────────────

function linkDeps({ kind = "invite", lifetime = 86400, authFails = false } = {}) {
  const calls = { keys: 0, links: [] };
  return {
    calls,
    deps: {
      api: {
        async getKeys(ref) {
          calls.keys++;
          assert.equal(ref, "acmeprojectref000001");
          return { anonKey: "anon", serviceRoleKey: SERVICE_KEY, kind: "legacy" };
        },
        async getLinkLifetime() { return lifetime; },
      },
      auth: {
        async generateAdminLink(input) {
          calls.links.push(input);
          if (authFails) throw new Error(`upstream said no for key ${SERVICE_KEY}`);
          return { link: "https://acmeprojectref000001.supabase.co/auth/v1/verify?token=onetime&type=" + kind, kind };
        },
      },
      config: config(true),
      now: () => Date.parse("2026-11-07T10:00:00Z"),
    },
  };
}

test("a link is made with a freshly fetched key, redirects to set-password and says how long it works", async () => {
  const { deps, calls } = linkDeps();
  const result = await createAdminLink(deps, TENANT, { email: "boss@acme.az", fullName: "Boss" });
  assert.equal(result.ok, true);
  assert.equal(calls.keys, 1);
  assert.deepEqual(calls.links[0], {
    apiUrl: "https://acmeprojectref000001.supabase.co",
    serviceRoleKey: SERVICE_KEY,
    email: "boss@acme.az",
    fullName: "Boss",
    redirectTo: "https://acme.erp.test/auth/set-password",
  });
  assert.equal(result.value.kind, "invite");
  assert.equal(result.value.validForSeconds, 86400);
  assert.equal(result.value.expiresAt, "2026-11-08T10:00:00.000Z");
  assert.ok(!JSON.stringify(result).includes(SERVICE_KEY), "the key never leaves the action");
});

test("links are refused for tenants that are not trial/active, unprovisioned or without an admin", async () => {
  const { deps, calls } = linkDeps();
  const admin = { email: "boss@acme.az", fullName: "Boss" };
  assert.deepEqual(await createAdminLink(deps, { ...TENANT, status: "suspended" }, admin), { ok: false, error: "notLinkable" });
  assert.deepEqual(await createAdminLink(deps, { ...TENANT, status: "provisioning" }, admin), { ok: false, error: "notLinkable" });
  assert.deepEqual(await createAdminLink(deps, { ...TENANT, projectRef: null }, admin), { ok: false, error: "notProvisioned" });
  assert.deepEqual(await createAdminLink(deps, TENANT, null), { ok: false, error: "noAdminEmail" });
  assert.equal(calls.keys, 0, "no key is fetched for a refused request");
  assert.equal((await createAdminLink(deps, { ...TENANT, status: "active" }, admin)).ok, true);
});

test("a failed link reports the error without the service key", async () => {
  const { deps } = linkDeps({ authFails: true });
  const result = await createAdminLink(deps, TENANT, { email: "boss@acme.az", fullName: "" });
  assert.equal(result.ok, false);
  assert.equal(result.error, "failed");
  assert.match(result.detail, /upstream said no/);
  assert.ok(!result.detail.includes(SERVICE_KEY));
});

test("site URL: primary domain first, else <slug>.<base domain>", () => {
  assert.equal(tenantSiteUrl({ slug: "acme", primaryDomain: null }, config(false)), "https://acme.erp.test");
  assert.equal(tenantSiteUrl({ slug: "acme", primaryDomain: "erp.acme.az" }, config(false)), "https://erp.acme.az");
});

test("link lifetime is read from mailer_otp_exp only, 1 hour when absent", async () => {
  const responses = [{ mailer_otp_exp: 7200, smtp_pass: "masked" }, {}];
  const urls = [];
  const api = createManagementApi({
    token: TOKEN,
    fetch: async (url, init) => {
      urls.push(`${init.method} ${url}`);
      return new Response(JSON.stringify(responses.shift()), { status: 200 });
    },
  });
  assert.equal(await api.getLinkLifetime("acmeprojectref000001"), 7200);
  assert.equal(await api.getLinkLifetime("acmeprojectref000001"), DEFAULT_LINK_LIFETIME_SECONDS);
  assert.equal(urls[0], "GET https://api.supabase.com/v1/projects/acmeprojectref000001/config/auth");
});

// ── The Supabase Auth adapter (fake tenant Auth + REST server) ───────────────

function fakeTenant({ existing }) {
  const requests = [];
  const fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ method, path: url.pathname, query: url.searchParams, body });
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

    if (url.pathname === "/auth/v1/admin/generate_link") {
      if (body.type === "invite" && existing) {
        return json({ code: "email_exists", msg: "A user with this email address has already been registered" }, 422);
      }
      return json({
        id: "user-1",
        aud: "authenticated",
        email: body.email,
        app_metadata: {},
        user_metadata: body.data ?? {},
        created_at: "2026-11-07T10:00:00Z",
        action_link: `https://acmeprojectref000001.supabase.co/auth/v1/verify?token=onetime-${body.type}&type=${body.type}`,
        email_otp: "123456",
        hashed_token: "hashed",
        redirect_to: url.searchParams.get("redirect_to"),
        verification_type: body.type,
      });
    }
    if (url.pathname === "/rest/v1/roles") {
      const accept = new Headers(init.headers).get("Accept") ?? "";
      return json(accept.includes("vnd.pgrst.object") ? { id: "role-admin" } : [{ id: "role-admin" }]);
    }
    if (url.pathname === "/rest/v1/profiles") return new Response(null, { status: 201 });
    return json({ message: `unexpected ${method} ${url.pathname}` }, 404);
  };
  return { fetch, requests };
}

const LINK_INPUT = {
  apiUrl: "https://acmeprojectref000001.supabase.co",
  serviceRoleKey: SERVICE_KEY,
  email: "boss@acme.az",
  fullName: "Boss",
  redirectTo: "https://acme.erp.test/auth/set-password",
};

test("adapter: a new admin gets an invite link (no email sent) and an Admin profile", async () => {
  const tenant = fakeTenant({ existing: false });
  const result = await createTenantAuth({ fetch: tenant.fetch }).generateAdminLink(LINK_INPUT);
  assert.equal(result.kind, "invite");
  assert.match(result.link, /type=invite/);
  const generate = tenant.requests.filter((r) => r.path === "/auth/v1/admin/generate_link");
  assert.equal(generate.length, 1);
  assert.equal(generate[0].body.type, "invite");
  assert.deepEqual(generate[0].body.data, { full_name: "Boss", role_name: "Admin" });
  assert.equal(generate[0].query.get("redirect_to"), LINK_INPUT.redirectTo);
  const profile = tenant.requests.find((r) => r.path === "/rest/v1/profiles");
  assert.equal(profile.method, "POST");
  assert.equal(profile.body.role_id, "role-admin");
  assert.equal(profile.body.email, "boss@acme.az");
  assert.ok(!tenant.requests.some((r) => r.path.endsWith("/invite")), "no invite email is sent");
});

test("adapter: an existing admin gets a set-password (recovery) link instead", async () => {
  const tenant = fakeTenant({ existing: true });
  const result = await createTenantAuth({ fetch: tenant.fetch }).generateAdminLink(LINK_INPUT);
  assert.equal(result.kind, "recovery");
  assert.match(result.link, /type=recovery/);
  const types = tenant.requests.filter((r) => r.path === "/auth/v1/admin/generate_link").map((r) => r.body.type);
  assert.deepEqual(types, ["invite", "recovery"]);
  assert.ok(!tenant.requests.some((r) => r.path === "/rest/v1/profiles"), "an existing profile is left alone");
});
