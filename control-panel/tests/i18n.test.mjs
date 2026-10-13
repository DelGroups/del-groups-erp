// Every UI string exists in az, en and ru (lib/i18n/messages.ts).   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MESSAGES, LOCALES, translate } from "../lib/i18n/messages.ts";
import { TENANT_STATUSES } from "../lib/tenants.ts";
import { EMAIL_KINDS } from "../lib/billing/email.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

function keys(node, prefix = "") {
  return Object.entries(node).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".next" || name === "tests") return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

test("az, en and ru have the same keys and no empty strings", () => {
  const en = keys(MESSAGES.en).sort();
  for (const locale of LOCALES) {
    assert.deepEqual(keys(MESSAGES[locale]).sort(), en, locale);
    for (const key of en) assert.ok(translate(MESSAGES[locale], key).trim(), `${locale}: ${key} is empty`);
  }
});

test("every t(\"...\") key used in the app exists", () => {
  const used = new Set();
  for (const file of sourceFiles(root)) {
    for (const [, key] of readFileSync(file, "utf8").matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"/g)) used.add(key);
  }
  assert.ok(used.size > 20, "expected to find the app's keys");
  for (const key of used) assert.notEqual(translate(MESSAGES.en, key), key, `missing key ${key}`);
});

test("keys built at run time exist: statuses, SSL states, audit actions", () => {
  const dynamic = [
    ...TENANT_STATUSES.map((s) => `tenants.statuses.${s}`),
    ...["pending", "active", "failed"].map((s) => `tenants.detail.sslStatuses.${s}`),
    ...["insert", "update", "delete", "migrate", "canary", "register_tenant_1", "subscription", "tenant_sync", "billing_run"].map((a) => `tenants.detail.actions.${a}`),
    ...["idle", "running", "succeeded", "failed"].map((s) => `migrations.statuses.${s}`),
    ...["migrated", "up_to_date", "planned", "failed", "busy"].map((o) => `migrations.outcomes.${o}`),
    ...["notConfigured", "notMigratable", "failedToStart"].map((e) => `migrations.errors.${e}`),
    ...["not_synced", "synced", "failed"].map((s) => `billing.subscription.syncStatuses.${s}`),
    ...["draft", "issued", "paid", "overdue", "void"].map((s) => `billingAdmin.invoices.statuses.${s}`),
    ...["renewal", "change", "manual"].map((k) => `billingAdmin.invoices.kinds.${k}`),
    ...EMAIL_KINDS.map((k) => `billingAdmin.emails.kinds.${k}`),
    ...["pending", "sent", "skipped", "failed"].map((s) => `billingAdmin.emails.statuses.${s}`),
    ...["pending", "succeeded", "failed", "refunded"].map((s) => `billingAdmin.tenant.paymentStatuses.${s}`),
    ...["bank_transfer", "card", "cash", "other"].map((m) => `billingAdmin.tenant.methods.${m}`),
    ...["admin", "billing"].map((s) => `billingAdmin.tenant.sources.${s}`),
    ...["monthly", "yearly"].map((p) => `billing.subscription.periods.${p}`),
    ...EMAIL_KINDS.flatMap((k) => [`billingEmail.${k}.subject`, `billingEmail.${k}.body`]),
    ...["beneficiary", "beneficiaryTaxId", "bankName", "bankCode", "bankTaxId", "swift", "correspondentAccount", "account", "reference"].map((b) => `invoiceDoc.bank.${b}`),
  ];
  for (const locale of LOCALES) {
    for (const key of dynamic) assert.notEqual(translate(MESSAGES[locale], key), key, `${locale}: ${key}`);
  }
});

test("placeholders are filled", () => {
  assert.equal(translate(MESSAGES.en, "tenants.detail.by", { actor: "a@b.c" }), "by a@b.c");
});
