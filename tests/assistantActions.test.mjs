// AST-4: Del Assistant proposes, the user confirms, a DRAFT is saved. A user without the permission never gets
// the tool and cannot confirm a forged proposal (SQL test); a name that matches several records or none leads
// to a question, not a guess; the fingerprint is the same on the server and in the browser; nothing is posted.
// The database part (own proposals only, claim once, fingerprint, permission, second confirm, expiry, audit)
// is supabase/tests/assistant_actions.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  assistantConfirmLimit,
  askBack,
  canonicalJson,
  checkCustomerArgs,
  checkDocumentArgs,
  checkExpenseArgs,
  claimError,
  computeLine,
  documentTotals,
  pickOne,
  proposalToolsFor,
  searchTerm,
} from "../src/lib/assistant/proposals.ts";
import { payloadHash, runProposalTool } from "../src/lib/assistant/proposeServer.ts";
import { applyStreamEvent } from "../src/lib/assistant/ui/thread.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const TODAY = "2026-11-15";
const C1 = "33333333-3333-4333-8333-333333333331";
const C2 = "33333333-3333-4333-8333-333333333332";
const P1 = "44444444-4444-4444-8444-444444444441";

test("a tool the user may not use is not even offered", () => {
  const none = proposalToolsFor(() => false);
  assert.deepEqual(none, []);
  const salesOnly = proposalToolsFor((p) => p === "can_create_invoice");
  assert.deepEqual(salesOnly.map((t) => t.name), ["propose_sale_draft"]);
  const all = proposalToolsFor(() => true);
  assert.deepEqual(all.map((t) => t.name), ["propose_sale_draft", "propose_purchase_draft", "propose_customer", "propose_expense"]);
  assert.ok(!all.some((t) => /post|pay|delete|reverse|cancel/.test(t.name)), "no tool posts, pays, deletes or reverses");
  const engine = read("src/lib/assistant/engine.ts");
  assert.match(engine, /const proposalTools = input\.proposals \? proposalToolsFor\(can\) : \[\];/);
  assert.match(engine, /input\.isAdmin \|\| userHasLegacyPermission\(input\.profile, permission as never\)/);
});

test("lines and totals: net, VAT on the net, rounded to cents", () => {
  const l = computeLine({ product_id: P1, product_code: "A1", product_name: "Panel", unit: "Ədəd", quantity: 3, unit_price: 10.005, discount_percent: 10, vat_rate: 18 });
  assert.equal(l.net, 27.01);
  assert.equal(l.vat, 4.86);
  assert.equal(l.total, 31.87);
  const t = documentTotals([l, computeLine({ ...l, quantity: 1, unit_price: 30, discount_percent: 0, vat_rate: 0 })]);
  assert.deepEqual(t, { subtotal: 57.01, vat_total: 4.86, total: 61.87 });
});

test("arguments are checked: partner, lines, quantities, prices, dates, VÖEN, expense amount", () => {
  assert.equal(checkDocumentArgs({ lines: [{ product: "x", quantity: 1 }] }, "customer", TODAY).ok, false);
  assert.equal(checkDocumentArgs({ customer: "Test", lines: [] }, "customer", TODAY).ok, false);
  assert.match(checkDocumentArgs({ customer: "Test", lines: [{ product: "x", quantity: 0 }] }, "customer", TODAY).error, /above zero/);
  assert.match(checkDocumentArgs({ customer: "Test", lines: [{ product: "x", quantity: 1, price: -1 }] }, "customer", TODAY).error, /negative/);
  assert.match(checkDocumentArgs({ customer: "Test", date: "15.11.2026", lines: [{ product: "x", quantity: 1 }] }, "customer", TODAY).error, /YYYY-MM-DD/);
  const ok = checkDocumentArgs({ customer: " Test ", lines: [{ product: "Arnə qara", quantity: 1, price: 30 }] }, "customer", TODAY);
  assert.deepEqual(ok, { ok: true, value: { partner: "Test", date: TODAY, warehouse: "", note: "", lines: [{ product: "Arnə qara", quantity: 1, price: 30, discount_percent: 0, vat_rate: 0 }] } });
  assert.equal(checkDocumentArgs({ customer: "T", lines: Array.from({ length: 31 }, () => ({ product: "x", quantity: 1 })) }, "customer", TODAY).ok, false);
  assert.match(checkCustomerArgs({ full_name: "Konik", voen: "123" }).error, /10 digits/);
  assert.equal(checkCustomerArgs({ full_name: "Konik MMC", voen: "1234 567 890" }).value.voen, "1234567890");
  assert.match(checkExpenseArgs({ category: "Rent", amount: 0 }, TODAY).error, /above zero/);
  assert.deepEqual(checkExpenseArgs({ category: "Rent", amount: 100.004, vat_rate: 18 }, TODAY).value, { category: "Rent", date: TODAY, amount: 100, vat_rate: 18, payee: "", description: "" });
});

test("names: an exact match wins, one partial match is taken, several or none mean asking the user", () => {
  const label = (r) => [r.full_name, r.code];
  assert.equal(pickOne([{ full_name: "Test", code: "C1" }, { full_name: "Test MMC", code: "C2" }], "test", label).row.code, "C1");
  assert.equal(pickOne([{ full_name: "Konik MMC", code: "C9" }], "konik", label).status, "one");
  const many = pickOne([{ full_name: "Arnə qara 2", code: "A2" }, { full_name: "Arnə qara 3", code: "A3" }], "Arnə qara", label);
  assert.deepEqual(many, { status: "many", options: ["Arnə qara 2 / A2", "Arnə qara 3 / A3"] });
  assert.match(askBack("product", "Arnə qara", many), /Ask the user which one; do not guess/);
  assert.match(askBack("customer", "Nofel", { status: "none" }), /No customer matches "Nofel"/);
  assert.equal(searchTerm("a%b_c,(d)"), "a b c d", "safe inside a PostgREST filter");
});

test("the fingerprint is the same on the server and in the browser, whatever the key order", () => {
  const a = { lines: [{ b: 2, a: 1 }], customer_id: "x", total: 30 };
  const b = { total: 30, customer_id: "x", lines: [{ a: 1, b: 2 }] };
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(canonicalJson(a), '{"customer_id":"x","lines":[{"a":1,"b":2}],"total":30}');
  assert.equal(payloadHash(a), createHash("sha256").update(canonicalJson(b)).digest("hex"));
  assert.notEqual(payloadHash(a), payloadHash({ ...a, total: 31 }));
  const exec = read("src/components/assistant/proposalExecute.ts");
  assert.match(exec, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(exec, /sha256Hex\(canonicalJson\(card\.payload\)\)/, "the card sends the fingerprint of what it showed");
});

/** The user's client: search results per table. The server client: records the stored proposal. */
function dbs(rows) {
  const inserted = [];
  const searches = [];
  const db = {
    from: (table) => ({
      select: () => {
        const q = {
          or: (f) => {
            searches.push({ table, f });
            return q;
          },
          limit: () => q,
          then: (res, rej) => Promise.resolve({ data: rows[table] ?? [], error: null }).then(res, rej),
        };
        return q;
      },
    }),
  };
  const admin = {
    from: (table) => ({
      insert: (row) => {
        inserted.push({ table, row });
        return { select: () => ({ single: () => Promise.resolve({ data: { id: "prop-1" }, error: null }) }) };
      },
    }),
  };
  return { db, admin, inserted, searches };
}

const ctx = (d, extra = {}) => {
  const cards = [];
  return {
    cards,
    ctx: { db: d.db, admin: d.admin, userId: "user-1", conversationId: "conv-1", can: () => true, today: TODAY, confirmLimit: 10000, onProposal: (c) => cards.push(c), ...extra },
  };
};

test("a sale proposal: names matched with the user's client, stored by the server, shown as a card, nothing saved", async () => {
  const d = dbs({
    customers: [{ id: C1, full_name: "Test", company_name: null, code: "C1" }, { id: C2, full_name: "Test Nofel", company_name: null, code: "C2" }],
    products: [{ id: P1, name: "Arnə qara 2", code: "AR2", unit: "Ədəd", sell_price: 25 }],
  });
  const { cards, ctx: c } = ctx(d);
  const r = await runProposalTool("propose_sale_draft", { customer: "test", lines: [{ product: "Arnə qara 2", quantity: 1, price: 30, vat_rate: 18 }] }, c);
  assert.equal(r.isError, false);
  assert.match(r.content, /NOT saved yet/);
  assert.match(r.content, /never say it was created/);
  assert.equal(d.inserted.length, 1);
  const row = d.inserted[0].row;
  assert.equal(d.inserted[0].table, "assistant_proposals");
  assert.equal(row.kind, "sale_draft");
  assert.equal(row.user_id, "user-1");
  assert.equal(row.payload.customer_id, C1, "the exact name wins");
  assert.equal(row.payload.total, 35.4);
  assert.equal(row.payload_hash, payloadHash(row.payload));
  assert.equal(row.second_confirm_required, false);
  assert.match(row.idempotency_key, /^[0-9a-f-]{36}$/);
  assert.equal(cards.length, 1);
  assert.deepEqual({ id: cards[0].id, hash: cards[0].hash, amount: cards[0].amount }, { id: "prop-1", hash: row.payload_hash, amount: 35.4 });
  assert.ok(d.searches.every((s) => !/[%]{2}|,,/.test(s.f)));
});

test("ambiguous or unknown names lead to a question, never a stored proposal", async () => {
  const many = dbs({ customers: [{ id: C1, full_name: "Tural A" }, { id: C2, full_name: "Tural B" }], products: [] });
  const a = ctx(many);
  const r1 = await runProposalTool("propose_sale_draft", { customer: "Tural", lines: [{ product: "x", quantity: 1 }] }, a.ctx);
  assert.match(r1.content, /Several customers match "Tural": Tural A; Tural B\. Ask the user which one/);
  assert.equal(many.inserted.length, 0);
  assert.equal(a.cards.length, 0);
  const noProduct = dbs({ customers: [{ id: C1, full_name: "Test" }], products: [] });
  const b = ctx(noProduct);
  const r2 = await runProposalTool("propose_sale_draft", { customer: "Test", lines: [{ product: "Unknown", quantity: 1 }] }, b.ctx);
  assert.match(r2.content, /No product matches "Unknown"/);
  assert.equal(noProduct.inserted.length, 0);
});

test("a big amount needs a second confirm; a customer that exists is not proposed again; a forged call is refused", async () => {
  const d = dbs({ customers: [{ id: C1, full_name: "Test" }], products: [{ id: P1, name: "Panel", code: "P", unit: "Ədəd", sell_price: 6000 }] });
  const { cards, ctx: c } = ctx(d);
  await runProposalTool("propose_sale_draft", { customer: "Test", lines: [{ product: "Panel", quantity: 2 }] }, c);
  assert.equal(d.inserted[0].row.second_confirm_required, true);
  assert.equal(cards[0].secondConfirm, true);
  assert.equal(cards[0].limit, 10000);

  const dup = dbs({ customers: [{ id: C1, full_name: "Konik MMC", code: "C7" }] });
  const r = await runProposalTool("propose_customer", { full_name: "konik mmc" }, ctx(dup).ctx);
  assert.match(r.content, /already exists \(C7\)/);
  assert.equal(dup.inserted.length, 0);

  const noRight = dbs({});
  const forged = await runProposalTool("propose_sale_draft", { customer: "Test", lines: [{ product: "x", quantity: 1 }] }, ctx(noRight, { can: () => false }).ctx);
  assert.deepEqual(forged, { content: "Permission denied for this user.", isError: true, links: [] });
  assert.equal(noRight.inserted.length, 0);
});

test("a purchase needs a warehouse: the default one, or a question", async () => {
  const d = dbs({ suppliers: [{ id: C1, full_name: "Supplier X" }], products: [{ id: P1, name: "Panel", unit: "Ədəd", sell_price: 10 }], warehouses: [{ id: "w1", name: "Main", is_default: false }, { id: "w2", name: "Second", is_default: false }] });
  const r = await runProposalTool("propose_purchase_draft", { supplier: "Supplier X", lines: [{ product: "Panel", quantity: 5, price: 8 }] }, ctx(d).ctx);
  assert.match(r.content, /Which warehouse/);
  const d2 = dbs({ suppliers: [{ id: C1, full_name: "Supplier X" }], products: [{ id: P1, name: "Panel", unit: "Ədəd", sell_price: 10 }], warehouses: [{ id: "w1", name: "Main", is_default: true }, { id: "w2", name: "Second" }] });
  await runProposalTool("propose_purchase_draft", { supplier: "Supplier X", lines: [{ product: "Panel", quantity: 5, price: 8 }] }, ctx(d2).ctx);
  assert.equal(d2.inserted[0].row.payload.warehouse_id, "w1");
  assert.equal(d2.inserted[0].row.payload.total, 40);
});

test("confirming saves a DRAFT with the form's own functions, from the server's copy; nothing is posted or paid", () => {
  const exec = read("src/components/assistant/proposalExecute.ts");
  const claimAt = exec.indexOf('rpc("assistant_proposal_claim"');
  const saveAt = exec.indexOf("SAVERS[claimed.kind](claimed.payload");
  const finishAt = exec.indexOf('rpc("assistant_proposal_finish"');
  assert.ok(claimAt > 0 && saveAt > claimAt && finishAt > saveAt, "claim, then save the server's payload, then finish");
  assert.match(exec, /from "@\/modules\/sales"/);
  assert.match(exec, /from "@\/modules\/purchases"/);
  assert.match(exec, /from "@\/modules\/expenses"/);
  assert.equal((exec.match(/mode: "draft"/g) ?? []).length, 2, "sales and purchases in draft mode");
  assert.match(exec, /post: false,\s*submit: false/, "the expense is neither posted nor sent for approval");
  assert.ok(!/post_sales_invoice_draft|post_purchase_invoice_draft|post_expense|create_partner_payment|mode: "post"|\.delete\(/.test(exec), "nothing is posted, paid or deleted");
  assert.equal(claimError("ERROR: hash_mismatch"), "hash_mismatch");
  assert.equal(claimError("already_decided"), "already_decided");
  assert.equal(claimError("weird"), "failed");
  // The modules expose exactly what the forms use.
  assert.match(read("src/modules/purchases/index.ts"), /export \{ submitPurchase \} from "\.\/lib\/submitPurchase";/);
  assert.match(read("src/modules/expenses/index.ts"), /export \{ saveExpenseAction \} from "\.\/actions\/expenses";/);
  // The proposals table: users read their own; only the server writes.
  const sql = read("supabase/migrations/20261121120000_assistant_actions.sql");
  assert.match(sql, /REVOKE ALL ON public\.assistant_proposals FROM PUBLIC, anon, authenticated;\s*GRANT SELECT ON public\.assistant_proposals TO authenticated;/);
  assert.match(sql, /'via', 'assistant'/);
  assert.match(sql, /INTERVAL '24 hours'/);
  assert.match(read(".github/workflows/db-baseline.yml"), /supabase\/tests\/assistant_actions\.sql/);
  assert.match(read("supabase/scripts/tenant1_preflight.sql"), /20261121120000_assistant_actions/);
});

test("the amount limit defaults to 10 000 AZN and follows ASSISTANT_CONFIRM_LIMIT_AZN", () => {
  assert.equal(assistantConfirmLimit({}), 10000);
  assert.equal(assistantConfirmLimit({ ASSISTANT_CONFIRM_LIMIT_AZN: "2500" }), 2500);
  assert.equal(assistantConfirmLimit({ ASSISTANT_CONFIRM_LIMIT_AZN: "-1" }), 10000);
});

test("a proposal in the stream becomes a card on the reply", () => {
  const card = { id: "p1", kind: "customer", summary: "New customer Test", amount: 0, payload: { full_name: "Test" }, hash: "a".repeat(64), secondConfirm: false, limit: 10000 };
  let ms = [{ id: "a", role: "assistant", content: "", status: "streaming", steps: [], links: [] }];
  ms = applyStreamEvent(ms, "a", { type: "proposal", proposal: card });
  ms = applyStreamEvent(ms, "a", { type: "proposal", proposal: { ...card, summary: "again" } });
  assert.equal(ms[0].proposals.length, 1, "the same proposal is shown once");
  assert.equal(ms[0].proposals[0].summary, "again");
  assert.match(read("src/components/assistant/AssistantThread.tsx"), /<ProposalCard key=\{p\.id\} card=\{p\}/);
  const route = read("src/app/api/assistant/chat/route.ts");
  assert.match(route, /onProposal: \(proposal\) => send\(\{ type: "proposal", proposal \}\)/);
});

test("the card: one main action, edit in form for documents, a second confirm, texts in az/en/ru", () => {
  const card = read("src/components/assistant/ProposalCard.tsx");
  assert.equal((card.match(/variant="primary"/g) ?? []).length, 1);
  assert.match(card, /card\.secondConfirm && state\.s !== "second"/);
  assert.match(card, /const canEditInForm = card\.kind === "sale_draft" \|\| card\.kind === "purchase_draft";/);
  assert.ok(!/<table|<select|window\.confirm/.test(card));
  for (const group of ["proposal", "proposalErrors"]) {
    const keys = Object.keys(azMessages.assistant[group]);
    for (const m of [enMessages, ruMessages]) assert.deepEqual(Object.keys(m.assistant[group]).sort(), [...keys].sort(), group);
    for (const k of keys) assert.ok(!/[А-Яа-яЁё]/.test(azMessages.assistant[group][k]), `no Cyrillic in az: ${k}`);
  }
  for (const [, , key] of card.matchAll(/t\("assistant\.(proposal|proposalErrors)\.([a-zA-Z_]+)"/g)) assert.ok(azMessages.assistant.proposal[key] ?? azMessages.assistant.proposalErrors[key], key);
  for (const code of ["hash_mismatch", "already_decided", "forbidden", "expired", "second_confirm_required", "not_found", "failed"]) {
    for (const m of [azMessages, enMessages, ruMessages]) assert.ok(m.assistant.proposalErrors[code], code);
  }
  for (const kind of ["sale_draft", "purchase_draft", "customer", "expense_draft"]) assert.ok(enMessages.assistant.proposal[`kind_${kind}`]);
});
