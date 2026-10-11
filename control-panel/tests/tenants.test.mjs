// Tenant record rules (lib/tenants.ts).   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTenantInput, suggestSlug, SLUG_PATTERN } from "../lib/tenants.ts";

const valid = { name: "Acme MMC", slug: "acme", status: "trial", country: "az", language: "en", currency: "azn", notes: "  " };

test("a valid form is cleaned: trimmed, codes upper-cased, empty notes become null", () => {
  const r = parseTenantInput(valid);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    name: "Acme MMC",
    slug: "acme",
    status: "trial",
    country: "AZ",
    language: "en",
    currency: "AZN",
    notes: null,
  });
});

test("defaults: provisioning, AZ, az, AZN", () => {
  const r = parseTenantInput({ name: "X", slug: "x" });
  assert.equal(r.ok, true);
  assert.equal(r.value.status, "provisioning");
  assert.equal(r.value.country, "AZ");
  assert.equal(r.value.language, "az");
  assert.equal(r.value.currency, "AZN");
});

test("each invalid field gets its own error key", () => {
  const r = parseTenantInput({
    name: "",
    slug: "-bad-",
    status: "gone",
    country: "AZE",
    language: "de",
    currency: "manat",
    notes: "x".repeat(2001),
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, {
    name: "nameRequired",
    slug: "slugInvalid",
    status: "statusInvalid",
    country: "countryInvalid",
    language: "languageInvalid",
    currency: "currencyInvalid",
    notes: "notesTooLong",
  });
  assert.equal(parseTenantInput({ ...valid, slug: "" }).errors.slug, "slugRequired");
  assert.equal(parseTenantInput({ ...valid, name: "x".repeat(201) }).errors.name, "nameTooLong");
});

test("slug rules", () => {
  for (const ok of ["a", "acme", "acme-2", "a1b2", "x".repeat(40)]) assert.ok(SLUG_PATTERN.test(ok), ok);
  for (const bad of ["", "-a", "a-", "Acme", "ac me", "acmé", "x".repeat(41)]) assert.ok(!SLUG_PATTERN.test(bad), bad);
  assert.equal(parseTenantInput({ ...valid, slug: "ACME" }).value.slug, "acme");
});

test("slug suggestion from a company name", () => {
  assert.equal(suggestSlug("Acme MMC"), "acme-mmc");
  assert.equal(suggestSlug("  Del Groups, LLC  "), "del-groups-llc");
  assert.equal(suggestSlug("Şəki Mebel"), "seki-mebel");
  assert.equal(suggestSlug("Ilıq Su"), "iliq-su");
  assert.equal(suggestSlug("x".repeat(60)), "x".repeat(40));
  assert.ok(SLUG_PATTERN.test(suggestSlug("A long name that ends at a hyphen boundary-")));
});
