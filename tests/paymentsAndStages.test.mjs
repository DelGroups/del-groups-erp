// IMP-5: one payment from several accounts (lines, defaults, totals, checks, entry preview), the
// payment status of import costs, and the stages of an import shipment.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  addPaymentLine,
  checkPayment,
  entryPreview,
  initialPaymentLines,
  lastAccountStorageKey,
  methodForAccount,
  paymentLinesPayload,
  paymentTotals,
  previewText,
  setLineAccount,
} from "../src/lib/payments/paymentLines.ts";
import { isLegacyLinesError } from "../src/lib/payments/invoicePaymentLines.ts";
import { costDueFc, costPaymentState, payBlockedReason } from "../src/modules/imports/lib/costPayments.ts";
import { daysInTransit, etaOverdue, nextAction, receiveWarning, stageOf, stageViews, STAGES } from "../src/modules/imports/lib/stages.ts";
import { azMessages } from "../src/i18n/messages/az.ts";
import { enMessages } from "../src/i18n/messages/en.ts";
import { ruMessages } from "../src/i18n/messages/ru.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ABB = { id: "a-abb", name: "ABB bank", type: "bank", balance: 1000 };
const KASSA = { id: "a-kassa", name: "Kassa", type: "cash", balance: 500 };
const CARD = { id: "a-card", name: "Biznes kart", type: "card", balance: 50 };
const VAT = { id: "a-vat", name: "ƏDV depozit", type: "bank", isVatAccount: true };
const line = (accountId, amount, method = "cash") => ({ key: `${accountId}-${amount}`, accountId, method, amount, note: null });

// ── Lines and defaults ───────────────────────────────────────────────────────

test("the method follows the account type: cash desk → cash, bank → transfer, card → card", () => {
  assert.equal(methodForAccount(KASSA), "cash");
  assert.equal(methodForAccount(ABB), "transfer");
  assert.equal(methodForAccount(CARD), "card");
  assert.equal(methodForAccount({ type: "Kassa", name: "Mağaza" }), "cash");
  assert.equal(methodForAccount({ type: "Bank", name: "Kapital" }), "transfer");
  assert.equal(methodForAccount(null), "cash");
  // A method the user picked stays when the account changes.
  const l = { ...line("a-kassa", 10), method: "card" };
  assert.equal(setLineAccount(l, ABB, true).method, "card");
  assert.equal(setLineAccount(l, ABB, false).method, "transfer");
});

test("the first line: the open balance from the last-used account, else the first non-VAT one", () => {
  const [first] = initialPaymentLines({ amount: 150, accounts: [VAT, ABB, KASSA], lastAccountId: "a-kassa" });
  assert.deepEqual([first.accountId, first.method, first.amount], ["a-kassa", "cash", 150]);
  const [noLast] = initialPaymentLines({ amount: 150, accounts: [VAT, ABB, KASSA], lastAccountId: "gone" });
  assert.equal(noLast.accountId, "a-abb", "a VAT account is never the default");
  const preset = initialPaymentLines({ amount: 0, accounts: [], preset: [{ accountId: "a-abb", method: "transfer", amount: 100.005, note: "Base" }, { accountId: "a-vat", method: "transfer", amount: 18, note: "VAT" }] });
  assert.deepEqual(preset.map((p) => [p.accountId, p.amount]), [["a-abb", 100.01], ["a-vat", 18]]);
  // "+ Add an account" starts with what is left.
  assert.equal(addPaymentLine([line("a-abb", 100)], 50).at(-1).amount, 50);
  assert.equal(lastAccountStorageKey("u1", "out"), "payment:last-account:u1:out");
});

test("totals, remaining and overpayment (100 ABB + 50 Kassa of 150)", () => {
  const ctx = { currency: "AZN", openBalance: 150 };
  const two = [line("a-abb", 100, "transfer"), line("a-kassa", 50)];
  assert.deepEqual(paymentTotals(two, ctx), { totalAzn: 150, targetAzn: null, remaining: 0, unassignedAzn: 0 });
  assert.deepEqual(checkPayment(two, ctx).issues, []);
  // A partial payment is allowed.
  assert.equal(paymentTotals([line("a-abb", 100)], ctx).remaining, 50);
  assert.deepEqual(checkPayment([line("a-abb", 100)], ctx).issues, []);
  // Overpayment is blocked unless the caller allows an advance.
  assert.deepEqual(checkPayment([line("a-abb", 100), line("a-kassa", 60)], ctx).issues, ["overpay"]);
  assert.deepEqual(checkPayment([line("a-abb", 100), line("a-kassa", 60)], { ...ctx, allowAdvance: true }).issues, []);
  assert.equal(paymentTotals([line("a-abb", 160)], ctx).remaining, -10, "an advance is a negative remainder");
});

test("every line needs an account and a positive amount, each account once, no more lines than allowed", () => {
  const ctx = { currency: "AZN", openBalance: 100 };
  const bad = checkPayment([line(null, 10), line("a-abb", 0), line("a-abb", 20)], ctx);
  assert.deepEqual(bad.issues.sort(), ["account_required", "amount_positive", "duplicate_account"]);
  assert.equal(bad.badLines.length, 3);
  assert.deepEqual(checkPayment([], ctx).issues, ["no_lines"]);
  assert.deepEqual(checkPayment([line("a-abb", 50), line("a-kassa", 50)], { ...ctx, maxLines: 1 }).issues, ["too_many_lines"]);
  assert.deepEqual(paymentLinesPayload([line("a-abb", 49.999, "transfer"), line(null, 5)]), [{ account_id: "a-abb", amount: 50, method: "transfer", note: null }]);
});

test("another currency: amount × rate, and the lines must add up to it exactly", () => {
  const ctx = { currency: "USD", openBalance: 400, amountFc: 400, rate: 1.72 };
  const ok = [line("a-abb", 500, "transfer"), line("a-kassa", 188)];
  assert.deepEqual(paymentTotals(ok, ctx), { totalAzn: 688, targetAzn: 688, remaining: 0, unassignedAzn: 0 });
  assert.deepEqual(checkPayment(ok, ctx).issues, []);
  assert.deepEqual(checkPayment([line("a-abb", 500)], ctx).issues, ["lines_mismatch"]);
  assert.deepEqual(checkPayment(ok, { ...ctx, amountFc: 401 }).issues.sort(), ["lines_mismatch", "overpay"]);
  assert.deepEqual(checkPayment(ok, { ...ctx, rate: 0 }).issues.sort(), ["lines_mismatch", "rate_required"]);
});

test("entry preview: Dt 2100 DGK 150.00 / Kt ABB 100.00, Kt Kassa 50.00; money in the other way; FX row", () => {
  const two = [line("a-abb", 100, "transfer"), line("a-kassa", 50)];
  const money = (n) => n.toFixed(2);
  const out = entryPreview({ direction: "out", counterpartyCode: "2100", counterpartyLabel: "DGK", lines: two, accounts: [ABB, KASSA] });
  assert.deepEqual(out.map((r) => previewText(r, money)), ["Dt 2100 DGK 150.00", "Kt ABB bank 100.00", "Kt Kassa 50.00"]);
  const inn = entryPreview({ direction: "in", counterpartyCode: "1200", counterpartyLabel: "Customer", lines: two, accounts: [ABB, KASSA] });
  assert.deepEqual(inn.map((r) => previewText(r, money)), ["Dt ABB bank 100.00", "Dt Kassa 50.00", "Kt 1200 Customer 150.00"]);
  // 400 USD booked at 1.70 (680) paid at 1.72 (688): Dt 2100 680, Kt cash 688, Dt 6260 8.
  const fx = entryPreview({ direction: "out", counterpartyCode: "2100", counterpartyLabel: "Trans", lines: [line("a-abb", 500), line("a-kassa", 188)], accounts: [ABB, KASSA], settledAzn: 680, fxLabels: { loss: "loss", gain: "gain" } });
  assert.deepEqual(fx.map((r) => previewText(r, money)), ["Dt 2100 Trans 680.00", "Kt ABB bank 500.00", "Kt Kassa 188.00", "Dt 6260 loss 8.00"]);
  const gain = entryPreview({ direction: "out", counterpartyCode: "2100", counterpartyLabel: "Trans", lines: [line("a-abb", 672)], accounts: [ABB], settledAzn: 680, fxLabels: { loss: "loss", gain: "gain" } });
  assert.equal(previewText(gain.at(-1), money), "Kt 4960 gain 8.00");
});

test("an older database without payment lines is recognised, so each line is posted on its own", () => {
  assert.ok(isLegacyLinesError("Kassa/bank hesabı seçilməlidir"));
  assert.ok(!isLegacyLinesError("Qalan borc: 10.00 AZN"));
});

// ── Payment status of import costs ───────────────────────────────────────────

const cost = (extra = {}) => ({ amount: 400, currencyCode: "USD", rateToAzn: 1.7, vatAmountAzn: 0, isEstimate: false, paidNow: false, ...extra });

test("cost status in a draft: not recorded / estimate → partly paid → paid (VAT included in what is due)", () => {
  assert.equal(costDueFc(cost()), 400);
  assert.equal(costDueFc({ amount: 200, currencyCode: "AZN", rateToAzn: 1, vatAmountAzn: 36 }), 236);
  assert.equal(costPaymentState({ cost: cost(), draft: true }).status, "not_recorded");
  assert.equal(costPaymentState({ cost: cost({ isEstimate: true }), draft: true }).status, "estimate");
  const part = costPaymentState({ cost: cost(), draft: true, advances: [{ amountFc: 150, amountAzn: 258, status: "open" }] });
  assert.deepEqual([part.status, part.openFc, part.openAzn, part.mode], ["partial", 250, 425, "advance"]);
  const paid = costPaymentState({ cost: cost(), draft: true, advances: [{ amountFc: 400, amountAzn: 688, status: "open" }] });
  assert.deepEqual([paid.status, paid.mode], ["paid", null]);
  assert.equal(costPaymentState({ cost: cost({ amount: 0 }), draft: true }).status, "nothing_due");
  assert.equal(costPaymentState({ cost: cost(), draft: true, advances: [{ amountFc: 400, amountAzn: 688, status: "cancelled" }] }).status, "not_recorded");
});

test("cost status once posted: owed X → partly paid → paid, from its payable", () => {
  const payable = { id: "p1", currencyCode: "AZN", amountFc: 236, amountAzn: 236, paidFc: 0, paidAzn: 0, status: "open" };
  const owed = costPaymentState({ cost: cost({ currencyCode: "AZN" }), draft: false, payable });
  assert.deepEqual([owed.status, owed.openAzn, owed.mode, owed.payableId], ["debt", 236, "payable", "p1"]);
  assert.equal(costPaymentState({ cost: cost(), draft: false, payable: { ...payable, paidFc: 100, paidAzn: 100 } }).status, "partial");
  assert.equal(costPaymentState({ cost: cost(), draft: false, payable: { ...payable, paidFc: 236, paidAzn: 236, status: "paid" } }).status, "paid");
  assert.equal(costPaymentState({ cost: cost({ paidNow: true }), draft: false }).status, "paid", "paid at once on confirm");
  assert.equal(payBlockedReason({ mode: "advance", partnerId: null, saved: true, dirty: false }), "no_partner");
  assert.equal(payBlockedReason({ mode: "advance", partnerId: "s1", saved: false, dirty: false }), "save_first");
  assert.equal(payBlockedReason({ mode: "advance", partnerId: "s1", saved: true, dirty: true }), "save_first");
  assert.equal(payBlockedReason({ mode: "payable", partnerId: null, saved: true, dirty: true }), null);
});

// ── Stages ───────────────────────────────────────────────────────────────────

test("stages: Sifariş → Yolda → Gömrükdə → Gömrükdən buraxıldı → Anbara qəbul → Bağlandı, cancelled apart", () => {
  assert.deepEqual(STAGES, ["order", "transit", "customs", "cleared", "receipt", "closed"]);
  assert.equal(stageOf({ status: "draft" }), "order");
  assert.equal(stageOf({ status: "confirmed" }), "transit");
  assert.equal(stageOf({ status: "confirmed", arrivedOn: "2026-10-20" }), "customs", "arrival at customs is a milestone");
  assert.equal(stageOf({ status: "cleared" }), "cleared");
  assert.equal(stageOf({ status: "partially_received" }), "receipt");
  assert.equal(stageOf({ status: "received" }), "receipt");
  assert.equal(stageOf({ status: "closed" }), "closed");
  assert.equal(stageOf({ status: "cancelled" }), null);
});

test("the next action is the stage bar's primary button", () => {
  assert.equal(nextAction({ status: "draft" }), "confirm");
  assert.equal(nextAction({ status: "confirmed" }), "arrived");
  assert.equal(nextAction({ status: "confirmed", arrivedOn: "2026-10-20" }), "clear");
  assert.equal(nextAction({ status: "cleared" }), "receive");
  assert.equal(nextAction({ status: "partially_received" }), "receive");
  assert.equal(nextAction({ status: "received" }), "close");
  assert.equal(nextAction({ status: "closed" }), null);
  assert.equal(nextAction({ status: "cancelled" }), null);
  assert.equal(receiveWarning("confirmed"), "not_cleared", "receiving before clearance is allowed with a warning");
  assert.equal(receiveWarning("cleared"), null);
});

test("each done stage shows its date; the current one is marked", () => {
  const v = stageViews({ status: "cleared", createdAt: "2026-10-03T10:42:00Z", confirmDate: "2026-10-06", departedOn: "2026-10-09", arrivedOn: "2026-10-28", clearedOn: "2026-10-29" });
  assert.deepEqual(v.map((s) => [s.stage, s.state, s.date]), [
    ["order", "done", "2026-10-03"],
    ["transit", "done", "2026-10-09"],
    ["customs", "done", "2026-10-28"],
    ["cleared", "current", "2026-10-29"],
    ["receipt", "next", null],
    ["closed", "next", null],
  ]);
  assert.equal(stageViews({ status: "closed", closedAt: "2026-11-01T12:00:00Z" }).at(-1).state, "done");
});

test("days in transit and an overdue ETA", () => {
  assert.equal(daysInTransit({ status: "confirmed", departedOn: "2026-10-09" }, "2026-10-30"), 21);
  assert.equal(daysInTransit({ status: "confirmed", confirmDate: "2026-10-06", arrivedOn: "2026-10-28" }, "2026-11-05"), 22);
  assert.equal(daysInTransit({ status: "draft", confirmDate: null }, "2026-10-30"), null);
  assert.equal(etaOverdue({ eta: "2026-10-27", status: "confirmed" }, "2026-10-30"), true);
  assert.equal(etaOverdue({ eta: "2026-10-27", status: "received" }, "2026-10-30"), false, "in the warehouse: not overdue");
  assert.equal(etaOverdue({ eta: "2026-11-02", status: "confirmed" }, "2026-10-30"), false);
});

// ── Wiring ───────────────────────────────────────────────────────────────────

test("migration: payment lines, cost advances, stages and the event log; one file, old calls kept", () => {
  const sql = read("supabase/migrations/20261105100000_imports_stages_pay.sql");
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.process_invoice_payment_event\(p_payload JSONB\)/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.create_partner_payment\(p_payload jsonb\)/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.pay_import_cost_advance\(/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.clear_import_shipment\(/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.update_import_tracking\(/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.log_import_event\(/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.import_shipment_events/);
  assert.match(sql, /ALTER TABLE public\.import_shipment_events ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /cost_line_id IS NULL/, "goods prepayments exclude cost advances");
  assert.match(sql, /DEFERRABLE INITIALLY DEFERRED/, "the draft save re-inserts a paid cost with its id");
  for (const t of ["imports_core", "imports_posting", "imports_fx"]) {
    assert.match(read(`supabase/tests/${t}.sql`), /\\ir \.\.\/migrations\/20261105100000_imports_stages_pay\.sql/, `${t} re-applies IMP-5`);
  }
  assert.match(read(".github/workflows/db-baseline.yml"), /supabase\/tests\/imports_stages_pay\.sql/);
});

test("the unified dialog is used for every payment form (UI_STANDARD) and its account lookup has no quick-create", () => {
  const dialog = read("src/components/payments/PaymentDialog.tsx");
  assert.match(dialog, /entity="account"[\s\S]{0,200}allowCreate=\{false\}/);
  for (const f of [
    "src/components/documents/DocumentPaymentModal.tsx",
    "src/components/payments/PaymentFormModal.tsx",
    "src/modules/payroll/components/PayPayrollModal.tsx",
    "src/modules/expenses/components/ExpensesPage.tsx",
    "src/modules/expenses/components/ExpensesScreen.tsx",
    "src/modules/imports/components/PostingPanel.tsx",
    "src/modules/imports/components/ImportFormScreen.tsx",
  ]) {
    assert.match(read(f), /<PaymentDialog\b/, f);
  }
  // The import costs grid has no "paid now" box or account lookup in the standard layout any more.
  const grid = read("src/modules/imports/components/ImportCostsGrid.tsx");
  assert.doesNotMatch(grid, /entity="account"/);
  assert.match(grid, /imports\.costPay\.pay/);
});

test("the payment dialog's texts exist in az, en and ru", () => {
  const keys = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [`${p}${k}`] : keys(v, `${p}${k}.`)));
  const az = keys(azMessages.paymentDialog).sort();
  assert.deepEqual(keys(enMessages.paymentDialog).sort(), az);
  assert.deepEqual(keys(ruMessages.paymentDialog).sort(), az);
  for (const m of [azMessages, enMessages, ruMessages]) {
    assert.ok(m.imports.stageNext.clear && m.imports.costPayStatus.partial && m.imports.timelineKinds.eta_changed && m.imports.transportModes.sea);
    assert.ok(m.official.splitPreset && m.importPosting.errors.declaration_required);
  }
});
