// Forms of the billing screens (prompt 13).   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBillingSettingsForm, parsePaymentForm, parseTenantBillingForm } from "../lib/billing/billingForms.ts";

const SETTINGS = {
  seller_name: " Del Groups MMC ", seller_tax_id: "1234567891", seller_address: "", seller_email: "billing@del-groups.com",
  seller_phone: "", bank_name: "Bank", bank_code: "", bank_tax_id: "", bank_swift: "", bank_correspondent_account: "",
  bank_account: "AZ00", invoice_prefix: "dg", tax_label: "ƏDV", tax_rate_pct: "18", payment_terms_days: "7",
  grace_days: "7", suspend_after_days: "30",
};

test("settings: trimmed, empty optional fields are null, prefix upper-cased", () => {
  const r = parseBillingSettingsForm(SETTINGS);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.value.seller_name, "Del Groups MMC");
  assert.equal(r.value.seller_address, null);
  assert.equal(r.value.invoice_prefix, "DG");
  assert.deepEqual([r.value.tax_rate_pct, r.value.payment_terms_days, r.value.grace_days, r.value.suspend_after_days], [18, 7, 7, 30]);
});

test("settings: every bad field is reported", () => {
  const r = parseBillingSettingsForm({
    ...SETTINGS, seller_email: "nope", invoice_prefix: "INV-2026", tax_label: "", tax_rate_pct: "120",
    payment_terms_days: "61", grace_days: "-1", suspend_after_days: "0",
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, {
    seller_email: "emailInvalid", invoice_prefix: "prefixInvalid", tax_label: "tooLong", tax_rate_pct: "percentInvalid",
    payment_terms_days: "numberInvalid", grace_days: "numberInvalid", suspend_after_days: "numberInvalid",
  });
});

test("tenant billing: email lower-cased, pause date checked, provider must be configured", () => {
  const ok = parseTenantBillingForm(
    { billing_email: " Finance@Acme.AZ ", billing_tax_id: "", billing_address: "Bakı", billing_paused_until: "2026-12-31", auto_billing: "on", payment_provider: "manual_bank_transfer" },
    ["manual_bank_transfer"]
  );
  assert.deepEqual(ok, {
    ok: true,
    value: { billing_email: "finance@acme.az", billing_tax_id: null, billing_address: "Bakı", billing_paused_until: "2026-12-31", auto_billing: true, payment_provider: "manual_bank_transfer" },
  });
  const bad = parseTenantBillingForm({ billing_email: "x@", billing_paused_until: "2026-02-30", payment_provider: "testpay" }, ["manual_bank_transfer"]);
  assert.deepEqual(bad.errors, { billing_email: "emailInvalid", billing_paused_until: "dateInvalid", payment_provider: "providerInvalid" });
  assert.equal(parseTenantBillingForm({}, ["manual_bank_transfer"]).value.auto_billing, false, "unticked = off");
});

test("payment: at most what is still owed, not in the future, a known method", () => {
  assert.deepEqual(parsePaymentForm({ amount: "88,50", paid_on: "2026-11-03", method: "bank_transfer", reference: " TX-1 " }, 88.5, "2026-11-04"), {
    ok: true,
    value: { amount: 88.5, paid_on: "2026-11-03", method: "bank_transfer", reference: "TX-1" },
  });
  assert.equal(parsePaymentForm({ amount: "10", method: "cash" }, 88.5, "2026-11-04").value.paid_on, "2026-11-04", "today by default");
  const bad = parsePaymentForm({ amount: "88.51", paid_on: "2026-11-05", method: "crypto" }, 88.5, "2026-11-04");
  assert.deepEqual(bad.errors, { amount: "amountInvalid", paid_on: "dateInvalid", method: "methodInvalid" });
  assert.equal(parsePaymentForm({ amount: "0", method: "cash" }, 10, "2026-11-04").errors.amount, "amountInvalid");
  assert.equal(parsePaymentForm({ amount: "1.234", method: "cash" }, 10, "2026-11-04").errors.amount, "amountInvalid");
});
