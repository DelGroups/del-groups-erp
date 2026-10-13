// Payment providers, billing emails and the invoice PDF (prompt 13).   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { manualBankTransfer, bankTransferLines } from "../lib/billing/providers/manualBankTransfer.ts";
import {
  cardGateway,
  cardGatewayConfig,
  CARD_GATEWAY_SIGNATURE_HEADER,
  signGatewayWebhook,
} from "../lib/billing/providers/cardGateway.ts";
import { providerRegistry } from "../lib/billing/providers/index.ts";
import { PaymentProviderError } from "../lib/billing/providers/types.ts";
import { billingEmail, emailSenderFromEnv, EMAIL_KINDS } from "../lib/billing/email.ts";
import { PDFDocument } from "pdf-lib";
import { renderInvoicePdf } from "../lib/billing/pdf.ts";
import { LOCALES } from "../lib/i18n/messages.ts";

const BANK = {
  seller_name: "Del Groups MMC",
  seller_tax_id: "1234567891",
  bank_name: "Test Bank",
  bank_account: "AZ00TEST0000000000000000000",
  bank_swift: "",
};
const INVOICE = { id: "11111111-2222-3333-4444-555555555555", number: "INV-2026-00001", tenantId: "t", amountCents: 12345, currency: "AZN", description: "x" };
const SECRET = "whsec-test-not-real-0001";
const GATEWAY_ENV = {
  CARD_GATEWAY_ID: "testpay",
  CARD_GATEWAY_API_URL: "https://gateway.invalid/api/",
  CARD_GATEWAY_MERCHANT_ID: "m-1",
  CARD_GATEWAY_SECRET_KEY: "sk-test-not-real-0001",
  CARD_GATEWAY_WEBHOOK_SECRET: SECRET,
};
const headers = (value) => new Headers(value ? { [CARD_GATEWAY_SIGNATURE_HEADER]: value } : {});

// ── Bank transfer ────────────────────────────────────────────────────────────

test("bank transfer: checkout shows the bank details with the invoice number as reference; no card, no webhook", async () => {
  const provider = manualBankTransfer(async () => BANK);
  assert.equal(provider.id, "manual_bank_transfer");
  const checkout = await provider.createCheckout(INVOICE, { returnUrl: null });
  assert.deepEqual(checkout, {
    kind: "instructions",
    reference: "INV-2026-00001",
    lines: [
      { label: "beneficiary", value: "Del Groups MMC" },
      { label: "beneficiaryTaxId", value: "1234567891" },
      { label: "bankName", value: "Test Bank" },
      { label: "account", value: "AZ00TEST0000000000000000000" },
      { label: "reference", value: "INV-2026-00001" },
    ],
  });
  await assert.rejects(provider.chargeSavedCard(INVOICE, { id: "c", token: "t" }), (e) => e instanceof PaymentProviderError && e.code === "not_supported");
  assert.deepEqual(await provider.refund({ reference: "r", amountCents: 1, currency: "AZN" }), { status: "pending", reference: null });
  assert.equal(await provider.verifyWebhook({ headers: headers(), rawBody: "{}", now: 0 }), null);
  assert.deepEqual(bankTransferLines({}, "X"), [{ label: "reference", value: "X" }]);
});

// ── Card gateway stub ────────────────────────────────────────────────────────

test("card gateway: settings come from env only; missing ones are listed and the registry leaves it out", async () => {
  assert.deepEqual(cardGatewayConfig({}).missing, [
    "CARD_GATEWAY_ID", "CARD_GATEWAY_API_URL", "CARD_GATEWAY_MERCHANT_ID", "CARD_GATEWAY_SECRET_KEY", "CARD_GATEWAY_WEBHOOK_SECRET",
  ]);
  assert.deepEqual(cardGatewayConfig({ ...GATEWAY_ENV, CARD_GATEWAY_ID: "Bad Id" }).missing, ["CARD_GATEWAY_ID"]);
  assert.equal(cardGatewayConfig(GATEWAY_ENV).config.apiUrl, "https://gateway.invalid/api");

  const off = providerRegistry({}, async () => BANK);
  assert.deepEqual(off.available().map((p) => p.id), ["manual_bank_transfer"]);
  assert.equal(off.get("testpay"), null);
  await assert.rejects(off.card.createCheckout(INVOICE, { returnUrl: null }), (e) => e.code === "not_configured");

  const on = providerRegistry(GATEWAY_ENV, async () => BANK);
  assert.deepEqual(on.available().map((p) => p.id), ["manual_bank_transfer", "testpay"]);
  const card = on.get("testpay");
  assert.equal(card.supportsSavedCards, true);
  for (const call of [() => card.createCheckout(INVOICE, { returnUrl: null }), () => card.chargeSavedCard(INVOICE, { id: "c", token: "t" }), () => card.refund({ reference: "r", amountCents: 1, currency: "AZN" })]) {
    await assert.rejects(call(), (e) => e instanceof PaymentProviderError && e.code === "not_implemented" && !e.message.includes(GATEWAY_ENV.CARD_GATEWAY_SECRET_KEY));
  }
});

test("card gateway webhook: valid signature and body give the event; wrong, stale or malformed ones give null", async () => {
  const card = cardGateway(GATEWAY_ENV);
  const now = 1_800_000_000_000;
  const body = JSON.stringify({
    type: "payment.succeeded", reference: "pay_123", invoice_id: INVOICE.id, amount_cents: 12345, currency: "azn",
    occurred_at: "2026-11-03T10:00:00Z", card: { token: "tok_abc", brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 },
  });
  const event = await card.verifyWebhook({ headers: headers(signGatewayWebhook(body, SECRET, now - 1000)), rawBody: body, now });
  assert.deepEqual(event, {
    type: "payment.succeeded", reference: "pay_123", invoiceId: INVOICE.id, amountCents: 12345, currency: "AZN",
    occurredAt: "2026-11-03T10:00:00Z", savedCard: { token: "tok_abc", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 },
  });

  const verify = (h, raw = body, at = now) => card.verifyWebhook({ headers: headers(h), rawBody: raw, now: at });
  assert.equal(await verify(signGatewayWebhook(body, "other-secret-0000", now)), null, "wrong secret");
  assert.equal(await verify(signGatewayWebhook(body, SECRET, now - 6 * 60_000)), null, "older than five minutes");
  assert.equal(await verify(signGatewayWebhook(body, SECRET, now), body.replace("12345", "99999")), null, "body changed after signing");
  assert.equal(await verify(null), null, "no signature");
  const bad = JSON.stringify({ type: "payment.succeeded", reference: "x", invoice_id: "not-a-uuid", amount_cents: 1, currency: "AZN" });
  assert.equal(await verify(signGatewayWebhook(bad, SECRET, now), bad), null, "malformed body");
  assert.equal(await cardGateway({}).verifyWebhook({ headers: headers("t=1,v1=00"), rawBody: body, now }), null, "not configured");
});

// ── Emails ───────────────────────────────────────────────────────────────────

test("every billing email exists in az, en and ru with the invoice facts filled in", () => {
  for (const language of LOCALES) {
    for (const kind of EMAIL_KINDS) {
      const e = billingEmail(kind, {
        language, company: "Acme <MMC>", seller: "Del Groups", number: "INV-2026-00009", amount: 425.98, currency: "AZN",
        dueDate: "2026-11-01", readOnlyOn: "2026-11-09", suspendOn: "2026-12-09", daysOverdue: 8, bank: BANK,
      });
      assert.ok(!/\{[a-zA-Z]+\}/.test(e.subject + e.text), `${language}/${kind}: unfilled placeholder`);
      assert.ok(!e.text.includes("billingEmail."), `${language}/${kind}: missing text`);
      if (kind !== "reactivated") assert.match(e.subject + e.text, /INV-2026-00009/);
      assert.ok(!e.html.includes("<MMC>"), "names are escaped in HTML");
    }
  }
  const pastDue = billingEmail("past_due", { language: "en", company: "Acme", seller: "Del Groups", number: "N-1", amount: 10, currency: "AZN", dueDate: "2026-11-01", readOnlyOn: "2026-11-09", bank: BANK });
  assert.match(pastDue.text, /until 09\.11\.2026/);
  assert.match(pastDue.text, /Account \(IBAN\): AZ00TEST/);
  const thanks = billingEmail("reactivated", { language: "en", company: "Acme", seller: "Del Groups", number: "N-1", amount: 10, currency: "AZN", dueDate: null, bank: BANK });
  assert.ok(!thanks.text.includes("IBAN"), "no bank details once paid");
});

test("email sender: without settings nothing is sent; with them one POST carries the PDF in base64", async () => {
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ id: "em_1" }), { status: 200 });
  };
  const off = emailSenderFromEnv({}, fake);
  assert.deepEqual(off.missing, ["BILLING_EMAIL_API_KEY", "BILLING_EMAIL_FROM"]);
  await assert.rejects(off.send({ to: "a@b.c", subject: "s", text: "t", html: "h" }));
  assert.equal(calls.length, 0);

  const on = emailSenderFromEnv({ BILLING_EMAIL_API_KEY: "re_test_not_real", BILLING_EMAIL_FROM: "Billing <billing@example.com>" }, fake);
  const r = await on.send({ to: "a@b.c", subject: "s", text: "t", html: "h", attachments: [{ filename: "x.pdf", content: new Uint8Array([37, 80, 68, 70]) }] });
  assert.deepEqual(r, { id: "em_1" });
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(calls[0].init.headers.Authorization, "Bearer re_test_not_real");
  const sent = JSON.parse(calls[0].init.body);
  assert.deepEqual([sent.from, sent.to, sent.attachments[0]], ["Billing <billing@example.com>", ["a@b.c"], { filename: "x.pdf", content: "JVBERg==" }]);

  const failing = emailSenderFromEnv({ BILLING_EMAIL_API_KEY: "k", BILLING_EMAIL_FROM: "f" }, async () => new Response(JSON.stringify({ message: "bad from" }), { status: 422 }));
  await assert.rejects(failing.send({ to: "a@b.c", subject: "s", text: "t", html: "h" }), /HTTP 422: bad from/);
});

// ── PDF ──────────────────────────────────────────────────────────────────────

const DOC = {
  id: "i", number: "INV-2026-00001", status: "issued", currency: "AZN", language: "az",
  issued_at: "2026-10-25T00:00:00Z", due_date: "2026-11-01", period_start: "2026-11-01", period_end: "2026-12-01",
  subtotal: 120, tax: 21.6, total: 141.6, amount_paid: 0, notes: null,
  seller: { ...BANK, address: "Bakı, Nəsimi r-nu", tax_label: "ƏDV", tax_rate_pct: 18 },
  buyer: { name: "Şirkət MMC", tax_id: "9876543210", email: "a@b.az" },
  lines: [{ description: "Platformanın əsas haqqı", quantity: 1, unit_price: 120, amount: 120 }],
};

test("invoice PDF: a valid PDF in every language, the same bytes for the same invoice, long invoices get more pages", async () => {
  for (const language of LOCALES) {
    const bytes = await renderInvoicePdf({ ...DOC, language });
    assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
    assert.ok(bytes.length < 120_000, `${language}: fonts are subset (${bytes.length} bytes)`);
  }
  const a = await renderInvoicePdf(DOC);
  const b = await renderInvoicePdf(DOC);
  assert.deepEqual(Buffer.from(a), Buffer.from(b));

  const many = Array.from({ length: 80 }, (_, i) => ({ description: `Line ${i + 1} with a description long enough to wrap onto a second row of the table`, quantity: 1, unit_price: 1, amount: 1 }));
  const long = await renderInvoicePdf({ ...DOC, status: "paid", amount_paid: 80, subtotal: 80, tax: 0, total: 80, lines: many });
  const pages = (await PDFDocument.load(long)).getPageCount();
  assert.ok(pages >= 3, `expected several pages, got ${pages}`);
});
