// SaaS phase 1: company details come from company_profile, not from code.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  companyDisplayName,
  companyInitials,
  companyLegalName,
  EMPTY_COMPANY_PROFILE,
  emailPlaceholder,
  isMissingTableError,
  mergeProfileEdit,
  profileFromLegacy,
  profileFromRow,
  profileToRow,
} from "../src/lib/company/profile.ts";

const full = {
  ...EMPTY_COMPANY_PROFILE,
  displayName: "ACME HOLDING MMC",
  legalName: "Acme Holding MMC",
  voen: "1234567891",
  email: "info@acme.az",
  logoUrl: "https://x.supabase.co/storage/v1/object/public/crm-assets/company/logo.png",
  sealUrl: "https://x.supabase.co/storage/v1/object/public/crm-assets/seals/seal.png",
};

test("row round-trip keeps every field", () => {
  assert.deepEqual(profileFromRow(profileToRow(full)), full);
});

test("rows are cleaned: trimmed text, valid currency and VAT only", () => {
  const p = profileFromRow({
    display_name: "  ACME  ",
    default_currency: "usd",
    default_vat_rate: "12.5",
  });
  assert.equal(p.displayName, "ACME");
  assert.equal(p.defaultCurrency, "USD");
  assert.equal(p.defaultVatRate, 12.5);

  const bad = profileFromRow({ default_currency: "dollars", default_vat_rate: 250 });
  assert.equal(bad.defaultCurrency, "AZN");
  assert.equal(bad.defaultVatRate, 18);
  assert.deepEqual(profileFromRow(null), EMPTY_COMPANY_PROFILE);
});

test("legacy fallback uses the precedence the screens used before", () => {
  const p = profileFromLegacy(
    { company_name: "ACME (header)", voen: "111", phone: "+994 12", address: "Old", logo_url: "logo.png" },
    { company_name: "Acme (legal)", voen: "", address: "New", phone: "", email: "a@b.az", bank_name: "Bank", iban: "AZ00", vat_rate: 18, currency: "AZN" },
    "seal.png"
  );
  assert.equal(p.displayName, "ACME (header)", "header read settings");
  assert.equal(p.legalName, "Acme (legal)", "prints preferred company_settings");
  assert.equal(p.voen, "111", "empty company VÖEN falls back to settings");
  assert.equal(p.address, "New");
  assert.equal(p.phone, "+994 12");
  assert.equal(p.logoUrl, "logo.png");
  assert.equal(p.sealUrl, "seal.png");

  const onlySettings = profileFromLegacy({ company_name: "X" }, null);
  assert.equal(onlySettings.legalName, "X");
  assert.deepEqual(profileFromLegacy(null, null), { ...EMPTY_COMPANY_PROFILE });
});

test("names never come out empty", () => {
  assert.equal(companyDisplayName(full, "PRODUCT"), "ACME HOLDING MMC");
  assert.equal(companyLegalName(full, "PRODUCT"), "Acme Holding MMC");
  assert.equal(companyDisplayName({ ...full, displayName: "" }, "PRODUCT"), "Acme Holding MMC");
  assert.equal(companyLegalName({ ...full, legalName: "" }, "PRODUCT"), "ACME HOLDING MMC");
  assert.equal(companyDisplayName(EMPTY_COMPANY_PROFILE, "PRODUCT"), "PRODUCT");
});

test("initials: first two words, legal form ignored", () => {
  assert.equal(companyInitials("ACME HOLDING MMC"), "AH");
  assert.equal(companyInitials("Acme MMC"), "A");
  assert.equal(companyInitials("Şəki İpək"), "Şİ");
  assert.equal(companyInitials("ООО Ромашка"), "ОР", "a leading legal form is kept");
  assert.equal(companyInitials(""), "?");
});

test("e-mail placeholder uses the company domain when known", () => {
  assert.equal(emailPlaceholder({ email: "info@acme.az" }), "ad@acme.az");
  assert.equal(emailPlaceholder({ email: "info@acme.az" }, "info"), "info@acme.az");
  assert.equal(emailPlaceholder({ email: "" }), "ad@example.com");
  assert.equal(emailPlaceholder({ email: "broken@" }), "ad@example.com");
});

test("non-admins cannot change name, logo or seal", () => {
  const edit = { displayName: "NEW", logoUrl: "", phone: "+994 50" };
  const asManager = mergeProfileEdit(full, edit, { isAdmin: false });
  assert.deepEqual(asManager.refused.sort(), ["displayName", "logoUrl"]);
  assert.equal(asManager.profile.displayName, full.displayName);
  assert.equal(asManager.profile.logoUrl, full.logoUrl);
  assert.equal(asManager.profile.phone, "+994 50", "other fields still apply");

  const asAdmin = mergeProfileEdit(full, edit, { isAdmin: true });
  assert.deepEqual(asAdmin.refused, []);
  assert.equal(asAdmin.profile.displayName, "NEW");
  assert.equal(asAdmin.profile.logoUrl, "");
});

test("an edit only touches the fields it provides", () => {
  const { profile } = mergeProfileEdit(full, { phone: "1", unknown: "x", iban: undefined }, { isAdmin: false });
  assert.deepEqual(profile, { ...full, phone: "1" });
});

test("missing-table errors are recognised", () => {
  assert.equal(isMissingTableError({ code: "42P01" }), true);
  assert.equal(isMissingTableError({ code: "PGRST205", message: "Could not find the table 'public.company_profile'" }), true);
  assert.equal(isMissingTableError({ message: 'relation "public.company_profile" does not exist' }), true);
  assert.equal(isMissingTableError({ code: "42501", message: "permission denied" }), false);
  assert.equal(isMissingTableError(null), false);
});

test("no company specifics in src outside src/lib/brand.ts", () => {
  const root = decodeURIComponent(new URL("../src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  const allowed = new Set([join("lib", "brand.ts")]);
  const pattern = /del[ _-]?groups|DEL GROUPS MMC/i;
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx|js|mjs|css|json)$/.test(name) && !allowed.has(relative(root, path))) {
        if (pattern.test(readFileSync(path, "utf8"))) offenders.push(relative(root, path).split(sep).join("/"));
      }
    }
  };
  walk(root);
  assert.deepEqual(offenders, []);
});
