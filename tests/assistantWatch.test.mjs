// AST-5: the assistant's active watch. Every rule with a positive and a negative fixture, fixes that clear
// their warning, ignoring and silence, the debounce, the form adapters, the "unusual draft" check (signals,
// hash, cache, reply parsing, the server pass with a stand-in Claude client, the route's rate limit),
// the after-save polling, the nightly learning from watch events, and the texts in az / en / ru.
// The database part (who may read the context, the events table, own findings only) is supabase/tests/assistant_watch.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyPatch,
  checkDraft,
  createDebouncer,
  dots,
  EMPTY_WATCH_MEMORY,
  ignoreIssue,
  isSilenced,
  issueId,
  issueKey,
  SILENCE_AFTER,
  visibleIssues,
  WATCH_CODES,
  WATCH_DEBOUNCE_MS,
  worstSeverity,
} from "../src/lib/assistant/watch/rules.ts";
import { bakuToday, contextKey, emptyWatchContext, parseWatchContext } from "../src/lib/assistant/watch/context.ts";
import { draftFromForm, formLinePatch, isBlankLine, patchFormLines } from "../src/lib/assistant/watch/formDraft.ts";
import {
  createAnswerCache,
  draftHash,
  parseDraftSummary,
  parseUnusualReply,
  RARE_MIN_DOCUMENTS,
  summarizeDraft,
  unusualSignals,
  WATCH_AI_INTERVAL_MS,
} from "../src/lib/assistant/watch/unusual.ts";
import { checkUnusualDraft } from "../src/lib/assistant/watch/unusualServer.ts";
import { detectWatchPatterns, WATCH_FIX_MIN, WATCH_IGNORE_MIN } from "../src/lib/assistant/learn.ts";
import { rateLimit } from "../src/lib/rateLimit.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const TODAY = "2026-11-20";
const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const P2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

const line = (over = {}) => ({
  index: 0,
  productId: P1,
  productName: "Vint M8",
  quantity: 10,
  unit: "ədəd",
  unitPrice: 2,
  discountPercent: 0,
  vatRate: 18,
  availableStock: 100,
  ...over,
});
const draft = (over = {}) => ({
  docType: "sale",
  date: TODAY,
  partnerId: "pppppppp-pppp-4ppp-8ppp-pppppppppppp",
  lines: [line()],
  total: 20,
  paid: 0,
  payments: [],
  ...over,
});
const ctx = (over = {}) => ({
  today: TODAY,
  rules: {
    B1: { enabled: true, params: { tolerance: 0.01 } },
    B2: { enabled: true, params: { days: 2 } },
    B4: { enabled: true, params: {} },
    B6: { enabled: true, params: { max_discount_pct: 30, tolerance: 0.01 } },
    B7: { enabled: true, params: { factor: 5, min_documents: 5 } },
  },
  closedMonths: [],
  products: { [P1]: { unit: "ədəd", sell_price: 2, cost: 1, usual_price: 2, usual_qty: 10, times: 4 } },
  partner: { documents: 8, median_total: 25, recent: [] },
  ...over,
});
const codes = (issues) => issues.map((i) => i.code);
const has = (d, c, code) => codes(checkDraft(d, c)).includes(code);

// ─── A clean draft ──────────────────────────────────────────────────────────

test("a normal sale and a normal purchase raise nothing", () => {
  assert.deepEqual(checkDraft(draft(), ctx()), []);
  assert.deepEqual(checkDraft(draft({ docType: "purchase" }), ctx()), []);
  assert.deepEqual(checkDraft(draft(), emptyWatchContext(TODAY)), []);
});

// ─── Every rule: positive and negative ──────────────────────────────────────

test("closed_period: a date in a closed month is an error, fixed to today", () => {
  const c = ctx({ closedMonths: ["2026-10"] });
  const issues = checkDraft(draft({ date: "2026-10-15" }), c);
  const i = issues.find((x) => x.code === "closed_period");
  assert.equal(i.severity, "error");
  assert.equal(i.params.month, "10.2026");
  assert.deepEqual(i.fix, { target: "header", field: "date", value: TODAY });
  assert.ok(!has(draft({ date: "2026-11-15" }), c, "closed_period"));
});

test("future_date (B4): a later date warns; today does not; off when the guard rule is off", () => {
  const i = checkDraft(draft({ date: "2026-12-01" }), ctx()).find((x) => x.code === "future_date");
  assert.equal(i.params.date, "01.12.2026");
  assert.equal(i.guardRule, "B4");
  assert.ok(!has(draft(), ctx(), "future_date"));
  assert.ok(!has(draft({ date: "2026-12-01" }), ctx({ rules: { B4: { enabled: false } } }), "future_date"));
});

test("negative_value (B1): a negative quantity, price or discount is an error with the positive value as fix", () => {
  for (const [field, over] of [["quantity", { quantity: -3 }], ["unitPrice", { unitPrice: -2 }], ["discountPercent", { discountPercent: -5 }]]) {
    const i = checkDraft(draft({ lines: [line(over)] }), ctx()).find((x) => x.code === "negative_value");
    assert.equal(i.severity, "error");
    assert.equal(i.fix.field, field);
    assert.equal(i.fix.value, Math.abs(Object.values(over)[0]));
  }
  assert.ok(!has(draft(), ctx(), "negative_value"));
});

test("zero_price (B6): a zero price is an error on a sale (fix: usual price), a warning on a purchase", () => {
  const i = checkDraft(draft({ lines: [line({ unitPrice: 0 })] }), ctx()).find((x) => x.code === "zero_price");
  assert.equal(i.severity, "error");
  assert.equal(i.fix.value, 2);
  const p = checkDraft(draft({ docType: "purchase", lines: [line({ unitPrice: 0 })] }), ctx()).find((x) => x.code === "zero_price");
  assert.equal(p.severity, "warning");
  const noFacts = checkDraft(draft({ lines: [line({ unitPrice: 0 })] }), ctx({ products: {} })).find((x) => x.code === "zero_price");
  assert.equal(noFacts.fix, undefined);
  assert.ok(!has(draft(), ctx(), "zero_price"));
  assert.ok(!has(draft({ lines: [line({ unitPrice: 0, quantity: 0 })] }), ctx(), "zero_price"), "an empty quantity is not checked yet");
});

test("high_discount (B6): above max_discount_pct warns with the maximum as fix; the guard's threshold is used", () => {
  const i = checkDraft(draft({ lines: [line({ discountPercent: 40 })] }), ctx()).find((x) => x.code === "high_discount");
  assert.deepEqual([i.params.discount, i.params.max, i.fix.value], [40, 30, 30]);
  assert.ok(!has(draft({ lines: [line({ discountPercent: 30 })] }), ctx(), "high_discount"));
  assert.ok(!has(draft({ lines: [line({ discountPercent: 40 })] }), ctx({ rules: { B6: { params: { max_discount_pct: 50 } } } }), "high_discount"));
  assert.ok(!has(draft({ docType: "purchase", lines: [line({ discountPercent: 40 })] }), ctx(), "high_discount"));
});

test("below_cost (B6): a sale below cost warns with the usual or list price as fix; at cost is fine", () => {
  const c = ctx({ products: { [P1]: { unit: "ədəd", sell_price: 2.5, cost: 1.5, usual_price: 2, usual_qty: 10, times: 4 } } });
  const i = checkDraft(draft({ lines: [line({ unitPrice: 1.2 })] }), c).find((x) => x.code === "below_cost");
  assert.deepEqual([i.params.price, i.params.cost, i.fix.value], [1.2, 1.5, 2]);
  assert.ok(!has(draft({ lines: [line({ unitPrice: 1.5 })] }), c, "below_cost"));
  assert.ok(!has(draft({ docType: "purchase", lines: [line({ unitPrice: 1.2 })] }), c, "below_cost"));
  assert.ok(!has(draft({ lines: [line({ unitPrice: 1.2 })] }), ctx({ products: { [P1]: { cost: null } } }), "below_cost"), "no cost (no permission) → no rule");
});

test("price_far: more than 30% from this partner's usual price warns; needs history", () => {
  const i = checkDraft(draft({ lines: [line({ unitPrice: 3 })] }), ctx()).find((x) => x.code === "price_far");
  assert.deepEqual([i.params.pct, i.params.usual, i.fix.value], [50, 2, 2]);
  assert.ok(!has(draft({ lines: [line({ unitPrice: 2.4 })] }), ctx(), "price_far"));
  assert.ok(!has(draft({ lines: [line({ unitPrice: 3 })] }), ctx({ products: { [P1]: { usual_price: 2, times: 1 } } }), "price_far"));
});

test("quantity_unusual: ten times the usual quantity warns; needs history", () => {
  assert.ok(has(draft({ lines: [line({ quantity: 100 })] }), ctx(), "quantity_unusual"));
  assert.ok(!has(draft({ lines: [line({ quantity: 99 })] }), ctx(), "quantity_unusual"));
  assert.ok(!has(draft({ lines: [line({ quantity: 100 })] }), ctx({ products: { [P1]: { usual_qty: 10, times: 1 } } }), "quantity_unusual"));
});

test("stock_short: a sale above what is available warns; unknown stock and purchases do not", () => {
  const i = checkDraft(draft({ lines: [line({ quantity: 12, availableStock: 5 })] }), ctx()).find((x) => x.code === "stock_short");
  assert.deepEqual([i.params.quantity, i.params.available], [12, 5]);
  assert.ok(!has(draft({ lines: [line({ quantity: 5, availableStock: 5 })] }), ctx(), "stock_short"));
  assert.ok(!has(draft({ lines: [line({ quantity: 12, availableStock: null })] }), ctx(), "stock_short"));
  assert.ok(!has(draft({ docType: "purchase", lines: [line({ quantity: 12, availableStock: 5 })] }), ctx(), "stock_short"));
});

test("unit_mismatch: a unit that is not the product's warns with the product's unit as fix (case-insensitive)", () => {
  const i = checkDraft(draft({ lines: [line({ unit: "kq" })] }), ctx()).find((x) => x.code === "unit_mismatch");
  assert.deepEqual([i.params.unit, i.params.expected, i.fix.value], ["kq", "ədəd", "ədəd"]);
  assert.ok(!has(draft({ lines: [line({ unit: "ƏDƏD" })] }), ctx(), "unit_mismatch"));
});

test("vat_unusual: a rate other than 18% or 0% warns; empty VAT is not checked", () => {
  assert.equal(checkDraft(draft({ lines: [line({ vatRate: 20 })] }), ctx()).find((x) => x.code === "vat_unusual").fix.value, 18);
  assert.ok(!has(draft({ lines: [line({ vatRate: 0 })] }), ctx(), "vat_unusual"));
  assert.ok(!has(draft({ lines: [line({ vatRate: null })] }), ctx(), "vat_unusual"));
});

test("overpaid (B1): paid above the total plus the tolerance is an error", () => {
  assert.ok(has(draft({ paid: 25 }), ctx(), "overpaid"));
  assert.ok(!has(draft({ paid: 20.005 }), ctx(), "overpaid"));
  assert.ok(!has(draft({ paid: 25 }), ctx({ rules: { B1: { enabled: false } } }), "overpaid"));
});

test("cash_no_account: a payment without a cash or bank account is an error", () => {
  assert.ok(has(draft({ payments: [{ amount: 10, accountId: null }] }), ctx(), "cash_no_account"));
  assert.ok(!has(draft({ payments: [{ amount: 10, accountId: "acc" }] }), ctx(), "cash_no_account"));
  assert.ok(!has(draft({ payments: [{ amount: 0, accountId: null }] }), ctx(), "cash_no_account"));
});

test("credit_limit: what the customer would owe above the limit warns; no limit means no rule", () => {
  const i = checkDraft(draft({ total: 200, lines: [line({ quantity: 100, unitPrice: 2 })], creditLimit: 500, openReceivables: 400 }), ctx({ products: {} })).find((x) => x.code === "credit_limit");
  assert.deepEqual([i.params.owed, i.params.limit], [600, 500]);
  assert.ok(!has(draft({ total: 20, creditLimit: 500, openReceivables: 400 }), ctx(), "credit_limit"));
  assert.ok(!has(draft({ total: 20, creditLimit: 0, openReceivables: 4000 }), ctx(), "credit_limit"));
});

test("possible_duplicate (B2): same partner and total within the guard's days warns", () => {
  const c = ctx({ partner: { documents: 8, median_total: 25, recent: [{ doc_no: "SS-0042", doc_date: "2026-11-19", total: 20 }] } });
  const i = checkDraft(draft(), c).find((x) => x.code === "possible_duplicate");
  assert.deepEqual([i.params.doc, i.params.date, i.guardRule], ["SS-0042", "19.11.2026", "B2"]);
  assert.ok(!has(draft({ date: "2026-11-25" }), c, "possible_duplicate"));
  assert.ok(!has(draft({ total: 21, lines: [line({ unitPrice: 2.1 })] }), c, "possible_duplicate"));
});

test("unusual_total (B7): above factor × median with enough history warns", () => {
  const big = draft({ total: 200, lines: [line({ quantity: 100 })] });
  const i = checkDraft(big, ctx()).find((x) => x.code === "unusual_total");
  assert.deepEqual([i.params.factor, i.params.median], [8, 25]);
  assert.ok(!has(draft({ total: 100 }), ctx(), "unusual_total"));
  assert.ok(!has(big, ctx({ partner: { documents: 3, median_total: 25, recent: [] } }), "unusual_total"));
});

test("errors come before warnings, and every code the rules raise is in WATCH_CODES", () => {
  const issues = checkDraft(draft({ date: "2026-12-01", paid: 99, lines: [line({ vatRate: 20 })] }), ctx());
  assert.equal(issues[0].severity, "error");
  for (const i of issues) assert.ok(WATCH_CODES.includes(i.code));
  assert.equal(issueKey("overpaid"), "assistant.watch.overpaid");
  assert.equal(dots("2026-11-20"), "20.11.2026");
  assert.equal(dots("2026-11"), "11.2026");
  assert.equal(dots("garbage"), "garbage");
});

// ─── Fixes clear their warning ──────────────────────────────────────────────

test("applying each rule's fix clears that warning", () => {
  const cases = [
    [draft({ date: "2026-10-15" }), ctx({ closedMonths: ["2026-10"] }), "closed_period"],
    [draft({ date: "2026-12-01" }), ctx(), "future_date"],
    [draft({ lines: [line({ quantity: -10 })] }), ctx(), "negative_value"],
    [draft({ lines: [line({ unitPrice: 0 })] }), ctx(), "zero_price"],
    [draft({ lines: [line({ discountPercent: 40 })] }), ctx(), "high_discount"],
    [draft({ lines: [line({ unitPrice: 3 })] }), ctx(), "price_far"],
    [draft({ lines: [line({ unit: "kq" })] }), ctx(), "unit_mismatch"],
    [draft({ lines: [line({ vatRate: 20 })] }), ctx(), "vat_unusual"],
    [draft({ lines: [line({ unitPrice: 0.5 })] }), ctx({ products: { [P1]: { unit: "ədəd", sell_price: 2, cost: 1, usual_price: 2, usual_qty: 10, times: 4 } } }), "below_cost"],
  ];
  for (const [d, c, code] of cases) {
    const issue = checkDraft(d, c).find((x) => x.code === code);
    assert.ok(issue?.fix, `${code} has a fix`);
    assert.ok(!has(applyPatch(d, issue.fix), c, code), `${code} is gone after its fix`);
  }
});

// ─── Ignoring and silence ───────────────────────────────────────────────────

test("ignore hides one warning; three ignores of the same code silence it for the form", () => {
  const a = { code: "vat_unusual", severity: "warning", lineIndex: 0, params: {} };
  const b = { code: "vat_unusual", severity: "warning", lineIndex: 1, params: {} };
  const c = { code: "vat_unusual", severity: "warning", lineIndex: 2, params: {} };
  const d = { code: "vat_unusual", severity: "warning", lineIndex: 3, params: {} };
  let m = ignoreIssue(EMPTY_WATCH_MEMORY, a);
  assert.deepEqual(visibleIssues([a, b], m).map(issueId), ["vat_unusual:1"]);
  m = ignoreIssue(ignoreIssue(m, b), c);
  assert.equal(SILENCE_AFTER, 3);
  assert.ok(isSilenced(m, "vat_unusual"));
  assert.deepEqual(visibleIssues([d], m), []);
  assert.ok(!isSilenced(m, "overpaid"));
  assert.equal(worstSeverity([a]), "warning");
  assert.equal(worstSeverity([a, { ...a, severity: "error" }]), "error");
  assert.equal(worstSeverity([]), null);
});

// ─── Debounce ───────────────────────────────────────────────────────────────

test("the rules run once, 400 ms after the last change", () => {
  const timers = [];
  const fake = { set: (fn, ms) => (timers.push({ fn, ms, live: true }), timers.length - 1), clear: (h) => (timers[h].live = false) };
  const calls = [];
  const deb = createDebouncer((x) => calls.push(x), WATCH_DEBOUNCE_MS, fake);
  deb.push(1);
  deb.push(2);
  deb.push(3);
  assert.equal(WATCH_DEBOUNCE_MS, 400);
  assert.deepEqual(timers.map((t) => t.live), [false, false, true]);
  timers.filter((t) => t.live).forEach((t) => t.fn());
  assert.deepEqual(calls, [3]);
  deb.push(4);
  deb.cancel();
  assert.equal(timers.at(-1).live, false);
});

// ─── The context ────────────────────────────────────────────────────────────

test("the context parser keeps good facts and drops malformed ones", () => {
  const c = parseWatchContext(
    {
      rules: { B6: { enabled: true, params: { max_discount_pct: 25 } }, B2: { enabled: false } },
      closed_months: ["2026-10", "bad", 7],
      products: { [P1]: { unit: "ədəd", sell_price: "2.5", cost: null, usual_price: 2, usual_qty: "x", times: 3 } },
      partner: { documents: 6, median_total: 30, recent: [{ doc_no: "SS-1", doc_date: "2026-11-01", total: 30 }] },
    },
    TODAY
  );
  assert.deepEqual(c.closedMonths, ["2026-10"]);
  assert.equal(c.rules.B2.enabled, false);
  assert.deepEqual(c.products[P1], { unit: "ədəd", sell_price: 2.5, cost: null, usual_price: 2, usual_qty: null, times: 3 });
  assert.equal(c.partner.recent[0].doc_no, "SS-1");
  assert.deepEqual(parseWatchContext(null, TODAY), emptyWatchContext(TODAY));
  assert.equal(contextKey("sale", null, [P2, P1, P1]), `sale||${P1},${P2}`);
  assert.equal(bakuToday(new Date("2026-11-20T21:30:00Z")), "2026-11-21");
});

// ─── The form adapters ──────────────────────────────────────────────────────

test("draftFromForm skips spare rows, keeps form indexes, and leaves fixed discounts out of percent checks", () => {
  const lines = [
    { product_id: P1, product_name: "Vint", quantity: 2, unit: "ədəd", unit_price: "3", discount_percent: 5, vat_rate: 18 },
    { product_id: "", product_name: "", quantity: 0, unit_price: 0 },
    { product_id: P2, product_name: "Qayka", quantity: 1, unit: "ədəd", unit_price: 4, discount_percent: 2, discount_type: "fixed", vat_rate: "" },
  ];
  const d = draftFromForm({ docType: "sale", date: TODAY, partnerId: "", lines, total: 10, paid: 2, payments: [{ amount: 2, account_id: "" }, { amount: 0, account_id: null }], availableStock: (_l, i) => i * 10 });
  assert.deepEqual(d.lines.map((l) => l.index), [0, 2]);
  assert.equal(d.lines[0].unitPrice, 3);
  assert.equal(d.lines[1].discountPercent, 0);
  assert.equal(d.lines[1].vatRate, null);
  assert.equal(d.lines[1].availableStock, 20);
  assert.equal(d.partnerId, null);
  assert.deepEqual(d.payments, [{ amount: 2, accountId: null }]);
  assert.ok(isBlankLine(lines[1]));
});

test("a watch fix becomes the form's own line change", () => {
  const rows = [{ id: "a", unit_price: 1, unit: "kq" }, { id: "b", unit_price: 2, unit: "ədəd" }];
  const next = patchFormLines(rows, { target: "line", index: 1, field: "unitPrice", value: 5 });
  assert.equal(next[1].unit_price, 5);
  assert.equal(next[0], rows[0]);
  assert.equal(patchFormLines(rows, { target: "line", index: 9, field: "unit", value: "x" }), rows);
  assert.equal(patchFormLines(rows, { target: "header", field: "date", value: TODAY }), rows);
  assert.deepEqual(formLinePatch({ target: "line", index: 0, field: "unit", value: "ədəd" }), { unit: "ədəd" });
  assert.deepEqual(formLinePatch({ target: "line", index: 0, field: "vatRate", value: 18 }), { vat_rate: 18 });
});

test("the sales and purchase forms use the watch only through their own setters", () => {
  const sale = read("src/modules/sales/components/InvoiceForm.tsx");
  assert.match(sale, /useAssistantWatch\(\{[\s\S]*formId: "sales\.invoice"[\s\S]*handleItemChange\(row\.id, formLinePatch\(patch\)/);
  assert.match(sale, /useSavedDocumentWatch\(\{ entityType: "sale", entityId: justPostedId/);
  const purchase = read("src/modules/purchases/components/PurchaseForm.tsx");
  assert.match(purchase, /useAssistantWatch\(\{[\s\S]*formId: "purchases\.invoice"[\s\S]*updateItem\(row\.id, formLinePatch\(patch\)/);
  assert.match(purchase, /useSavedDocumentWatch\(\{ entityType: "purchase", entityId: justPostedId/);
  const hook = read("src/components/assistant/useAssistantWatch.ts");
  assert.match(hook, /const active = ui\.active && input\.enabled !== false;/);
  // The only write is the user's own watch event.
  assert.deepEqual([...hook.matchAll(/\.from\("([a-z_]+)"/g)].map((m) => m[1]), ["assistant_watch_events"]);
});

// ─── The bubble ─────────────────────────────────────────────────────────────

test("the bubble is polite to screen readers, keyboard-reachable, and has one primary-free action row", () => {
  const bubble = read("src/components/assistant/AssistantWatchBubble.tsx");
  assert.match(bubble, /role="status" aria-live="polite"/);
  assert.match(bubble, /variant="secondary"[\s\S]*assistant\.watch\.fix/);
  assert.doesNotMatch(bubble, /variant="primary"/);
  assert.match(bubble, /if \(!ui\.active \|\| ui\.panel\.open\) return null;/);
  assert.match(read("src/components/assistant/AssistantPanel.tsx"), /<AssistantWatchBubble/);
});

// ─── The "unusual draft" check ──────────────────────────────────────────────

test("signals: a product this partner never had (with enough history) and a quantity far from the usual", () => {
  const c = ctx({ products: { [P1]: { usual_qty: 10, times: 4 }, [P2]: { times: 0 } } });
  const d = draft({ lines: [line({ quantity: 120 }), line({ index: 1, productId: P2, productName: "Yeni" })] });
  assert.deepEqual(unusualSignals(d, c).map((s) => s.kind), ["quantity_far", "rare_product"]);
  assert.deepEqual(unusualSignals(draft(), ctx()), []);
  assert.deepEqual(unusualSignals(d, ctx({ products: c.products, partner: { documents: RARE_MIN_DOCUMENTS - 1, median_total: 1, recent: [] } })).map((s) => s.kind), ["quantity_far"]);
  assert.deepEqual(unusualSignals(draft({ lines: [line({ quantity: 1 })] }), c).map((s) => s.kind), ["quantity_far"], "a tenth of the usual is unusual too");
});

test("the summary has no ids, survives the route's parser, and hashes the same for the same draft", () => {
  const c = ctx({ products: { [P1]: { usual_qty: 10, times: 4, usual_price: 2 } } });
  const d = draft({ lines: [line({ quantity: 120 })] });
  const s = summarizeDraft(d, c, unusualSignals(d, c));
  assert.doesNotMatch(JSON.stringify(s), /aaaaaaaa|pppppppp/);
  assert.deepEqual(parseDraftSummary(JSON.parse(JSON.stringify(s))), s);
  assert.equal(draftHash(s), draftHash(summarizeDraft(d, c, unusualSignals(d, c))));
  assert.notEqual(draftHash(s), draftHash({ ...s, total: s.total + 1 }));
  assert.equal(parseDraftSummary({ ...s, signals: [] }), null, "no signal → no call");
  assert.equal(parseDraftSummary({ ...s, docType: "journal" }), null);
  assert.equal(parseDraftSummary({ ...s, lines: [] }), null);
});

test("Haiku's reply: only unusual:true with a note is shown, trimmed and capped", () => {
  assert.equal(parseUnusualReply('{"unusual": true, "note": "  1000 ədəd?  Adətən 10. "}'), "1000 ədəd? Adətən 10.");
  assert.equal(parseUnusualReply('Sure: {"unusual": false, "note": "fine"}'), null);
  assert.equal(parseUnusualReply("not json"), null);
  assert.equal(parseUnusualReply(`{"unusual": true, "note": "${"x".repeat(400)}"}`).length, 220);
});

test("the answer cache keeps an answer for its time and drops the oldest when full", () => {
  let now = 0;
  const cache = createAnswerCache(1000, 2, () => now);
  cache.set("a", "note");
  cache.set("b", null);
  assert.equal(cache.get("a"), "note");
  assert.equal(cache.get("b"), null);
  cache.set("c", "x");
  assert.equal(cache.get("a"), undefined);
  now = 2000;
  assert.equal(cache.get("c"), undefined);
});

test("the route allows one new check per user and form every 20 seconds", () => {
  assert.equal(WATCH_AI_INTERVAL_MS, 20_000);
  const key = `assistant-watch:test-user:sales.invoice:${Math.random()}`;
  assert.equal(rateLimit(key, 1, WATCH_AI_INTERVAL_MS).allowed, true);
  assert.equal(rateLimit(key, 1, WATCH_AI_INTERVAL_MS).allowed, false);
  assert.equal(rateLimit(`${key}:other-form`, 1, WATCH_AI_INTERVAL_MS).allowed, true);
  const route = read("src/app/api/assistant/watch/route.ts");
  assert.match(route, /requireAuthenticatedApi\(\)/);
  assert.match(route, /assistantAccess\(/);
  assert.match(route, /answers\.get\(cacheKey\)[\s\S]*rateLimit\(`assistant-watch:\$\{auth\.user\.id\}:\$\{form\}`, 1, WATCH_AI_INTERVAL_MS\)/, "a cached answer does not count against the limit");
});

function fakeDb({ spent = 0 } = {}) {
  const inserts = [];
  return {
    inserts,
    rpc: async (name) => (name === "assistant_month_cost" ? { data: spent, error: null } : { data: [], error: null }),
    from: (table) => ({ insert: async (row) => (inserts.push({ table, row }), { error: null }) }),
  };
}

test("the server pass uses the fast model, logs its cost, and stops at the budget", async () => {
  const summary = { docType: "sale", date: TODAY, partnerDocuments: 8, partnerMedianTotal: 25, total: 240, lines: [{ product: "Vint", quantity: 120, unit: "ədəd", unitPrice: 2, usualPrice: 2, usualQty: 10, times: 4 }], signals: [{ kind: "quantity_far", product: "Vint", quantity: 120, usual: 10 }] };
  let asked = null;
  const client = { messages: { create: async (req) => ((asked = req), { content: [{ type: "text", text: '{"unusual": true, "note": "120 ədəd? Adətən 10."}' }], usage: { input_tokens: 300, output_tokens: 20 } }) } };
  const db = fakeDb();
  const env = { AI_MODEL_FAST: "claude-haiku-test", ASSISTANT_MONTHLY_BUDGET_USD: "10" };
  const r = await checkUnusualDraft({ apiKey: "k", userDb: fakeDb(), serverDb: db, userId: "u", summary, locale: "ru", env, client });
  assert.deepEqual(r, { ok: true, note: "120 ədəd? Adətən 10." });
  assert.equal(asked.model, "claude-haiku-test");
  assert.match(asked.messages[0].content, /Language for the note: Russian/);
  assert.equal(db.inserts[0].row.route_reason, "watch_unusual");
  assert.equal(db.inserts[0].row.tier, "fast");

  const broke = await checkUnusualDraft({ apiKey: "k", userDb: fakeDb(), serverDb: fakeDb({ spent: 10 }), userId: "u", summary, locale: "az", env, client: { messages: { create: async () => assert.fail("no call over budget") } } });
  assert.deepEqual(broke, { ok: false, reason: "budget" });
});

// ─── After save: polling ────────────────────────────────────────────────────

test("after save the author's document is checked every 60 s for 15 minutes (polling, no Realtime needed)", () => {
  const hook = read("src/components/assistant/useAssistantWatch.ts");
  assert.match(hook, /export const SAVED_POLL_MS = 60_000;/);
  assert.match(hook, /export const SAVED_POLL_FOR_MS = 15 \* 60_000;/);
  assert.match(hook, /window\.setInterval\(\(\) => void check\(\), SAVED_POLL_MS\)/);
  assert.match(hook, /Date\.now\(\) - started > SAVED_POLL_FOR_MS/);
  const server = read("src/lib/assistant/watch/loadContext.ts");
  assert.match(server, /rpc\("assistant_my_document_findings"/);
  assert.match(server, /createSupabaseServerClient/, "the user's own session: the database shows only their findings");
});

// ─── Learning from the watch ────────────────────────────────────────────────

test("the nightly job learns which warnings help (fixed often) and which annoy (always ignored)", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  const ev = (user, code, action, daysAgo = 1) => ({ user_id: user, code, action, created_at: new Date(now.getTime() - daysAgo * 86_400_000).toISOString() });
  const rows = [
    ...Array.from({ length: WATCH_FIX_MIN }, () => ev("u1", "below_cost", "fixed")),
    ...Array.from({ length: WATCH_IGNORE_MIN }, () => ev("u2", "vat_unusual", "ignored")),
    ...Array.from({ length: WATCH_IGNORE_MIN }, () => ev("u3", "vat_unusual", "ignored")),
    ev("u3", "vat_unusual", "fixed"),
    ...Array.from({ length: 9 }, () => ev("u4", "below_cost", "fixed", 30)),
    ...Array.from({ length: 9 }, () => ev("u5", "ai_note", "fixed")),
  ];
  const notes = detectWatchPatterns(rows, now);
  assert.deepEqual(notes.map((n) => [n.userId, n.kind]), [["u1", "skill_gap"], ["u2", "preference"]]);
  assert.match(read("src/lib/assistant/learnServer.ts"), /detectWatchPatterns\(watch, now\)/);
});

// ─── Texts ──────────────────────────────────────────────────────────────────

test("every warning and button has az / en / ru text with the same placeholders", () => {
  const keys = [...WATCH_CODES, "fix", "why", "ignore", "more", "savedProblem", "open", "dismiss", "whyQuestion"];
  const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const k of keys) {
    const az = azMessages.assistant.watch[k];
    const en = enMessages.assistant.watch[k];
    const ru = ruMessages.assistant.watch[k];
    assert.ok(az && en && ru, `assistant.watch.${k}`);
    assert.equal(ph(az), ph(en), `${k} az placeholders`);
    assert.equal(ph(ru), ph(en), `${k} ru placeholders`);
    if (k !== "ai_note") assert.match(ru, /[А-Яа-яЁё]/, `${k} ru is Russian`);
  }
});
