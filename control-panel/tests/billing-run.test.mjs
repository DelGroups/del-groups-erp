// The billing run (prompt 13) day by day on an in-memory control plane that follows the same
// rules as the SQL functions (issue_invoice, record_payment, set_billing_status, …; the SQL
// itself is checked by supabase/tests/billing.sql and scripts/tenants/e2e-billing.sh).
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { afterPayment, runBilling } from "../lib/billing/run.ts";
import { addDays, formatInvoiceNumber, invoiceTotals } from "../lib/billing/invoicing.ts";
import { providerRegistry } from "../lib/billing/providers/index.ts";
import { memoryEmailSender } from "../lib/billing/email.ts";

const CATALOG = [
  { id: "core", depends: [], is_core: true },
  { id: "inventory", depends: ["core"], is_core: false },
  { id: "accounting", depends: ["core"], is_core: false },
  { id: "sales", depends: ["core", "inventory", "accounting"], is_core: false },
];

function memoryStore({ tenants, settings = {} }) {
  const db = {
    settings: {
      invoice_prefix: "INV", tax_rate_pct: 18, payment_terms_days: 7, grace_days: 7, suspend_after_days: 30,
      seller_name: "Del Groups MMC", bank_name: "Test Bank", bank_account: "AZ00TEST", ...settings,
    },
    tenants: new Map(tenants.map((t) => [t.id, { status_source: "admin", billing_paused_until: null, billing_exempt: false, language: "en", ...t }])),
    invoices: [],
    payments: [],
    emails: [],
    counters: new Map(),
    pdfs: new Map(),
    cards: [],
    statusLog: [],
  };
  let seq = 0;
  const id = (p) => `${p}-${++seq}`;
  const open = (t) => db.invoices.filter((i) => i.tenant_id === t.id && ["issued", "overdue"].includes(i.status));
  const workItem = (t) => ({
    tenant_id: t.id, slug: t.slug, name: t.name, status: t.status, status_source: t.status_source, language: t.language,
    billing_email: t.billing_email ?? null, billing_paused_until: t.billing_paused_until, billing_exempt: t.billing_exempt,
    subscription: t.subscription && ["trial", "active", "past_due"].includes(t.subscription.status) ? structuredClone(t.subscription) : null,
    open_invoices: open(t).sort((a, b) => a.due_date.localeCompare(b.due_date)).map((i) => ({ ...i })),
    last_paid_invoice_id: db.invoices.filter((i) => i.tenant_id === t.id && i.status === "paid").at(-1)?.id ?? null,
  });
  const store = {
    db,
    async settings() { return { ...db.settings }; },
    async worklist() {
      return [...db.tenants.values()]
        .filter((t) => !t.billing_exempt && ((t.subscription?.auto_billing && ["trial", "active", "past_due"].includes(t.subscription.status)) || (t.status_source === "billing" && ["past_due", "read_only", "suspended"].includes(t.status))))
        .map(workItem);
    },
    async workItem(tenantId) { const t = db.tenants.get(tenantId); return t ? workItem(t) : null; },
    async catalog() { return CATALOG.map((m) => ({ id: m.id, depends: m.depends, isCore: m.is_core })); },
    async markOverdue(today) {
      let n = 0;
      for (const i of db.invoices) if (i.status === "issued" && i.due_date < today) { i.status = "overdue"; n++; }
      return n;
    },
    async issueInvoice(p) {
      const existing = db.invoices.find((i) => p.kind === "renewal" && i.kind === "renewal" && i.subscription_id === p.subscription_id && i.period_start === p.period_start && i.status !== "void");
      if (existing) return { id: existing.id, number: existing.number, created: false };
      const year = Number(p.issue_date.slice(0, 4));
      const n = (db.counters.get(year) ?? 0) + 1;
      db.counters.set(year, n);
      const totals = invoiceTotals(p.lines, db.settings.tax_rate_pct);
      const t = db.tenants.get(p.tenant_id);
      const inv = {
        id: id("inv"), tenant_id: p.tenant_id, subscription_id: p.subscription_id, number: formatInvoiceNumber(db.settings.invoice_prefix, year, n),
        kind: p.kind, status: "issued", currency: p.currency, total: totals.totalCents / 100, subtotal: totals.subtotalCents / 100, tax: totals.taxCents / 100,
        amount_paid: 0, issued_at: `${p.issue_date}T00:00:00Z`, due_date: p.due_date, period_start: p.period_start, period_end: p.period_end,
        pdf_path: null, charge_attempts: 0, last_charge_attempt_at: null, language: t.language, lines: p.lines, paid_at: null,
      };
      db.invoices.push(inv);
      return { id: inv.id, number: inv.number, created: true };
    },
    async advancePeriod(subId, fromEnd, newEnd) {
      const t = [...db.tenants.values()].find((x) => x.subscription?.id === subId);
      if (!t || t.subscription.current_period_end !== fromEnd) return false;
      t.subscription.current_period_start = fromEnd;
      t.subscription.current_period_end = newEnd;
      return true;
    },
    async invoiceDocument(invoiceId) {
      const i = db.invoices.find((x) => x.id === invoiceId);
      return { ...i, notes: null, seller: { name: db.settings.seller_name }, buyer: { name: db.tenants.get(i.tenant_id).name }, lines: i.lines };
    },
    async savePdf(inv, pdf) {
      const path = `${inv.tenantId}/${inv.number}.pdf`;
      db.pdfs.set(path, pdf);
      db.invoices.find((x) => x.id === inv.id).pdf_path = path;
      return path;
    },
    async setStatus(tenantId, status) {
      const t = db.tenants.get(tenantId);
      if (t.billing_exempt || t.status === status || !["trial", "active", "past_due", "read_only", "suspended"].includes(t.status)) return false;
      t.status = status;
      t.status_source = "billing";
      if (t.subscription) t.subscription.status = status === "active" ? "active" : "past_due";
      db.statusLog.push(status);
      return true;
    },
    async recordPayment(p) {
      const inv = db.invoices.find((x) => x.id === p.invoice_id);
      const dup = p.provider_reference && db.payments.find((x) => x.provider === p.provider && x.provider_reference === p.provider_reference);
      if (dup) return { payment_id: dup.id, duplicate: true, invoice_status: inv.status, tenant_id: inv.tenant_id };
      if (!["issued", "overdue"].includes(inv.status)) throw new Error(`invoice is not open (status ${inv.status})`);
      db.payments.push({ id: id("pay"), ...p, status: "succeeded" });
      inv.amount_paid = Math.round((inv.amount_paid + p.amount) * 100) / 100;
      if (inv.amount_paid >= inv.total) { inv.status = "paid"; inv.paid_at = p.paid_at; }
      return { payment_id: db.payments.at(-1).id, duplicate: false, invoice_status: inv.status, tenant_id: inv.tenant_id };
    },
    async noteChargeAttempt(invoiceId) {
      const inv = db.invoices.find((x) => x.id === invoiceId);
      inv.charge_attempts++;
      inv.last_charge_attempt_at = `${store.today}T06:00:00Z`;
    },
    async defaultCard(tenantId, provider) { return db.cards.find((c) => c.tenantId === tenantId && c.provider === provider) ?? null; },
    async claimEmail(row) {
      const existing = row.invoice_id && db.emails.find((e) => e.invoice_id === row.invoice_id && e.kind === row.kind);
      if (existing) {
        if (existing.status !== "failed") return null;
        existing.status = "pending";
        return existing.id;
      }
      db.emails.push({ id: id("em"), ...row, status: "pending" });
      return db.emails.at(-1).id;
    },
    async finishEmail(emailId, result) { Object.assign(db.emails.find((e) => e.id === emailId), result); },
  };
  return store;
}

const ACME = {
  id: "t-acme", slug: "acme", name: "Acme MMC", status: "active", billing_email: "finance@acme.test",
  subscription: {
    id: "s-acme", status: "active", billing_period: "monthly", currency: "AZN", user_count: 5,
    current_period_start: "2026-10-01", current_period_end: "2026-11-01", auto_billing: true, payment_provider: "manual_bank_transfer",
    modules: ["sales"], addons: {},
    plan: {
      id: "p", code: "business", name: "Business", annual_discount_pct: 17, max_users: 25, included_storage_gb: 20,
      included_ai_credit_usd: 5, includes_custom_domain: false,
      prices: [
        { module_id: null, amount: 50, per_user: false },
        { module_id: "sales", amount: 8, per_user: true },
        { module_id: "inventory", amount: 5, per_user: true },
        { module_id: "accounting", amount: 6, per_user: true },
      ],
      addon_prices: [],
    },
  },
};

function deps(store, extra = {}) {
  const notified = [];
  return {
    notified,
    deps: {
      store,
      providers: providerRegistry({}, async () => store.db.settings),
      email: memoryEmailSender(),
      renderPdf: async (doc) => new TextEncoder().encode(`%PDF-fake ${doc.number} ${doc.status}`),
      notifyTenantChanged: async (tenantId) => notified.push(tenantId),
      ...extra,
    },
  };
}

async function runDays(d, store, from, to) {
  for (let day = from; day <= to; day = addDays(day, 1)) {
    store.today = day;
    const summary = await runBilling(d, day);
    assert.equal(summary.ok, true, JSON.stringify(summary.results.map((r) => r.error)));
  }
}

test("a simulated unpaid invoice walks the tenant through every state and back to active after payment", async () => {
  const store = memoryStore({ tenants: [structuredClone(ACME)] });
  const { deps: d, notified } = deps(store);
  const acme = store.db.tenants.get("t-acme");
  const statusOn = {};
  for (let day = "2026-10-20"; day <= "2026-12-12"; day = addDays(day, 1)) {
    await runDays(d, store, day, day);
    statusOn[day] = acme.status;
  }

  // Renewal: issued 7 days before the renewal date, due on it, PDF stored, emailed once.
  const [first, second] = store.db.invoices;
  assert.deepEqual(
    [first.number, first.issued_at.slice(0, 10), first.due_date, first.period_start, first.period_end],
    ["INV-2026-00001", "2026-10-25", "2026-11-01", "2026-11-01", "2026-12-01"]
  );
  assert.equal(first.total, 171.1, "50 + 5 × (8 + 5 + 6) = 145, plus 18 % tax");
  assert.ok(store.db.pdfs.has(first.pdf_path));
  assert.equal(second.number, "INV-2026-00002");
  assert.equal(second.due_date, "2026-12-01");

  // Dunning: past_due after the due date, read-only after 7 days, suspended 30 days later.
  assert.equal(statusOn["2026-11-01"], "active");
  assert.equal(statusOn["2026-11-02"], "past_due");
  assert.equal(statusOn["2026-11-08"], "past_due");
  assert.equal(statusOn["2026-11-09"], "read_only");
  assert.equal(statusOn["2026-12-08"], "read_only");
  assert.equal(statusOn["2026-12-09"], "suspended");
  assert.deepEqual(store.db.statusLog, ["past_due", "read_only", "suspended"]);
  assert.equal(acme.subscription.status, "past_due");
  assert.equal(notified.length, 3, "the ERP is told at every step");
  // A suspended tenant gets no new renewal invoices; the period stopped moving with it.
  assert.equal(store.db.invoices.length, 2);
  assert.equal(acme.subscription.current_period_end, "2027-01-01");

  const sent = () => d.email.sent.map((m) => m.subject);
  assert.deepEqual(sent(), [
    "Invoice INV-2026-00001 from Del Groups MMC",
    "Invoice INV-2026-00001 is overdue",
    "Your ERP is read-only: invoice INV-2026-00001 is unpaid",
    "Invoice INV-2026-00002 from Del Groups MMC",
    "Your ERP is suspended: invoice INV-2026-00001 is unpaid",
  ]);
  assert.ok(d.email.sent.every((m) => m.to === "finance@acme.test"));
  assert.equal(d.email.sent[0].attachments[0].filename, "INV-2026-00001.pdf");

  // Paying the oldest invoice is not enough while the second is also late: the tenant follows
  // the invoice still owed (11 days late = read-only), it is not lifted to active.
  store.today = "2026-12-12";
  await store.recordPayment({ invoice_id: first.id, amount: first.total, method: "bank_transfer", provider: null, provider_reference: null, paid_at: "2026-12-12" });
  await afterPayment(d, first.id, "t-acme", "2026-12-12");
  assert.equal(acme.status, "read_only");

  // Paying everything reactivates at once, thanks once per invoice, and says so once.
  await store.recordPayment({ invoice_id: second.id, amount: second.total, method: "bank_transfer", provider: null, provider_reference: "BANK-778", paid_at: "2026-12-12" });
  const r = await afterPayment(d, second.id, "t-acme", "2026-12-12");
  assert.equal(r.statusTo, "active");
  assert.equal(acme.status, "active");
  assert.equal(acme.subscription.status, "active");
  assert.equal(notified.length, 5);
  assert.deepEqual(sent().slice(5), [
    "Payment received for invoice INV-2026-00001",
    "Your ERP is read-only: invoice INV-2026-00002 is unpaid",
    "Payment received for invoice INV-2026-00002",
    "Your ERP is active again",
  ]);
  assert.match(new TextDecoder().decode(store.db.pdfs.get(second.pdf_path)), /paid/, "the stored PDF is re-rendered as paid");

  // Running again changes nothing and sends nothing; the next renewal resumes.
  await runDays(d, store, "2026-12-12", "2026-12-12");
  assert.equal(d.email.sent.length, 9);
  assert.equal(acme.status, "active");
});

test("the same day twice issues one invoice and one email; reactivation waits for a status billing set", async () => {
  const store = memoryStore({ tenants: [structuredClone(ACME)] });
  const { deps: d } = deps(store);
  await runDays(d, store, "2026-10-25", "2026-10-25");
  await runDays(d, store, "2026-10-25", "2026-10-25");
  assert.equal(store.db.invoices.length, 1);
  assert.equal(d.email.sent.length, 1);

  // An admin suspended the tenant by hand: paying does not lift it.
  const acme = store.db.tenants.get("t-acme");
  acme.status = "suspended";
  acme.status_source = "admin";
  const inv = store.db.invoices[0];
  await store.recordPayment({ invoice_id: inv.id, amount: inv.total, method: "cash", provider: null, provider_reference: null, paid_at: null });
  await afterPayment(d, inv.id, "t-acme", "2026-10-26");
  assert.equal(acme.status, "suspended");
});

test("tenants exempt from billing (Del Groups) are never invoiced or dunned, whatever their subscription says", async () => {
  const delGroups = { ...structuredClone(ACME), id: "t-dg", slug: "del-groups", name: "Del Groups", billing_exempt: true };
  delGroups.subscription.id = "s-dg";
  const store = memoryStore({ tenants: [delGroups] });
  const { deps: d, notified } = deps(store);
  await runDays(d, store, "2026-10-20", "2026-12-31");
  assert.equal(store.db.invoices.length, 0);
  assert.equal(store.db.tenants.get("t-dg").status, "active");
  const one = await runBilling(d, "2026-12-31", { tenantId: "t-dg" });
  assert.deepEqual(one.results[0].notes, ["exempt from billing"]);
  assert.equal(notified.length + d.email.sent.length, 0);
});

test("without automatic billing nothing is issued; without an email address or provider the email is recorded as skipped", async () => {
  const manual = structuredClone(ACME);
  manual.subscription.auto_billing = false;
  const noMail = { ...structuredClone(ACME), id: "t-b", slug: "beta", billing_email: null };
  noMail.subscription.id = "s-b";
  const store = memoryStore({ tenants: [manual, noMail] });
  const { deps: d } = deps(store);
  await runDays(d, store, "2026-10-25", "2026-10-25");
  assert.deepEqual(store.db.invoices.map((i) => i.tenant_id), ["t-b"]);
  assert.deepEqual(store.db.emails.map((e) => [e.kind, e.status, e.error]), [["invoice_issued", "skipped", "no billing email for this tenant"]]);
  assert.equal(d.email.sent.length, 0);
});

test("a failed email is tried again on the next run; a free plan is not invoiced", async () => {
  const free = structuredClone(ACME);
  free.subscription.plan.prices = [];
  const store = memoryStore({ tenants: [free] });
  let fail = true;
  const { deps: d } = deps(store, {
    email: { missing: [], sent: [], async send(m) { if (fail) throw new Error("smtp down"); this.sent.push(m); return { id: "x" }; } },
  });
  await runDays(d, store, "2026-10-25", "2026-11-01");
  assert.equal(store.db.invoices.length, 0);
  assert.equal(store.db.tenants.get("t-acme").subscription.current_period_end, "2026-12-01", "the period still moves on");

  const paid = memoryStore({ tenants: [structuredClone(ACME)] });
  const second = deps(paid, { email: d.email });
  await runDays(second.deps, paid, "2026-10-25", "2026-10-25");
  assert.equal(paid.db.emails[0].status, "failed");
  fail = false;
  await runDays(second.deps, paid, "2026-11-02", "2026-11-02");
  assert.deepEqual(paid.db.emails.map((e) => [e.kind, e.status]), [["invoice_issued", "sent"], ["past_due", "sent"]]);
});

test("a saved card is charged on the due date through the provider; a declined card emails and dunning follows", async () => {
  const store = memoryStore({ tenants: [structuredClone(ACME)] });
  const acme = store.db.tenants.get("t-acme");
  acme.subscription.payment_provider = "testpay";
  store.db.cards.push({ tenantId: "t-acme", provider: "testpay", id: "card-1", token: "tok" });
  let decline = false;
  const charges = [];
  const card = {
    id: "testpay", supportsSavedCards: true, missing: [],
    async chargeSavedCard(inv, c) {
      charges.push([inv.number, inv.amountCents, c.token]);
      return decline ? { status: "failed", reference: null, reason: "insufficient funds" } : { status: "succeeded", reference: `ch_${charges.length}` };
    },
  };
  const { deps: d } = deps(store, { providers: { get: (pid) => (pid === "testpay" ? card : null), available: () => [card], card } });
  await runDays(d, store, "2026-10-25", "2026-11-03");
  assert.deepEqual(charges, [["INV-2026-00001", 17110, "tok"]], "charged once, on the due date");
  assert.equal(store.db.invoices[0].status, "paid");
  assert.equal(acme.status, "active");

  decline = true;
  await runDays(d, store, "2026-11-24", "2026-12-03");
  assert.equal(charges.length, 4, "three tries on three days, then no more");
  assert.equal(acme.status, "past_due");
  assert.deepEqual(
    store.db.emails.filter((e) => e.invoice_id === store.db.invoices[1].id).map((e) => e.kind),
    ["invoice_issued", "payment_failed", "past_due"]
  );
});
