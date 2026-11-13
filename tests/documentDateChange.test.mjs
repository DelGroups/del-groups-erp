// DATE-1: change the date of a posted sales / purchase invoice in place (DOC_DATE_CHANGE).
// The SQL rules are tested in supabase/tests/document_date_change.sql (CI: db-baseline).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  bakuToday,
  canApply,
  checkBlockedReason,
  DATE_CHANGE_CODES,
  dateChangeReducer,
  initialDateChangeState,
  isoToDots,
  issueItems,
  issueText,
  onlyDateChanged,
} from "../src/lib/documents/dateChange.ts";
import { isDocDateChangeEnabled } from "../src/lib/features/docDateChange.ts";
import { SETTINGS_ITEMS, settingsItemVisible } from "../src/lib/settings/items.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";
import { translate } from "../src/i18n/translate.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const run = (actions, from = initialDateChangeState()) => actions.reduce(dateChangeReducer, from);
const preview = (over = {}) => ({ ok: true, blockers: [], warnings: [], affected: { journals: 2 }, ...over });

// ── Dialog steps: fill in → check → tick warnings → apply ──────────────────

test("preview → acknowledge → apply: apply waits for a clean check, every warning and a reason", () => {
  let s = run([{ type: "date", value: "2026-11-01" }, { type: "check" }]);
  assert.equal(s.step, "checking");
  s = run([{ type: "previewed", preview: preview({ warnings: [{ code: "other_month", message: "x" }, { code: "payments_move", message: "y" }] }) }], s);
  assert.equal(s.step, "checked");
  assert.equal(canApply(s), false, "no reason, nothing ticked");
  s = run([{ type: "reason", value: "Invoice printed late" }, { type: "acknowledge", code: "other_month", value: true }], s);
  assert.equal(canApply(s), false, "one warning still open");
  s = run([{ type: "acknowledge", code: "payments_move", value: true }], s);
  assert.equal(canApply(s), true);
  s = run([{ type: "acknowledge", code: "payments_move", value: false }], s);
  assert.equal(canApply(s), false, "unticking takes it back");
  s = run([{ type: "acknowledge", code: "payments_move", value: true }, { type: "apply" }], s);
  assert.equal(s.step, "applying");
  assert.equal(run([{ type: "applied" }], s).step, "done");
});

test("a blocker keeps Apply off; a blank reason too", () => {
  const blocked = run([{ type: "date", value: "2026-11-01" }, { type: "check" }, { type: "previewed", preview: preview({ ok: false, blockers: [{ code: "stock_negative", message: "x" }] }) }, { type: "reason", value: "r" }]);
  assert.equal(canApply(blocked), false);
  const blank = run([{ type: "date", value: "2026-11-01" }, { type: "check" }, { type: "previewed", preview: preview() }, { type: "reason", value: "   " }]);
  assert.equal(canApply(blank), false);
});

test("changing the date or an option drops the check; the reason does not", () => {
  const checked = run([{ type: "date", value: "2026-11-01" }, { type: "check" }, { type: "previewed", preview: preview() }, { type: "reason", value: "r" }]);
  assert.equal(canApply(checked), true);
  const moved = run([{ type: "date", value: "2026-11-02" }], checked);
  assert.equal(moved.step, "edit");
  assert.equal(moved.preview, null);
  assert.equal(moved.reason, "r");
  const opt = run([{ type: "option", key: "move_same_day_payments", value: true }], checked);
  assert.equal(opt.preview, null);
  assert.equal(opt.options.move_same_day_payments, true);
  assert.equal(run([{ type: "reason", value: "other" }], checked).step, "checked");
});

test("a failed call keeps the check (or the form) and shows the message", () => {
  const s = run([{ type: "date", value: "2026-11-01" }, { type: "check" }, { type: "failed", message: "network" }]);
  assert.equal(s.step, "edit");
  assert.equal(s.error, "network");
  const after = run([{ type: "check" }, { type: "previewed", preview: preview() }, { type: "reason", value: "r" }, { type: "apply" }, { type: "failed", message: "Tarix dəyişdirilə bilməz" }], s);
  assert.equal(after.step, "checked");
});

test("Check needs a date that is not the current one and not in the future", () => {
  const s = (d) => ({ ...initialDateChangeState(), newDate: d });
  assert.equal(checkBlockedReason(s(null), "2026-11-05", "2026-11-13"), "dateChange.errors.dateRequired");
  assert.equal(checkBlockedReason(s("2026-11-05"), "2026-11-05", "2026-11-13"), "dateChange.errors.sameDate");
  assert.equal(checkBlockedReason(s("2026-11-14"), "2026-11-05", "2026-11-13"), "dateChange.errors.future");
  assert.equal(checkBlockedReason(s("2026-11-13"), "2026-11-05", "2026-11-13"), null, "today is fine");
  assert.equal(initialDateChangeState("2026-11-02").newDate, "2026-11-02", "the form's new date starts the dialog");
  assert.match(bakuToday(new Date("2026-11-12T21:30:00Z")), /^2026-11-13$/, "Baku is UTC+4");
});

test("form routing: only a date change goes to the date change, anything else stays an amendment", () => {
  assert.equal(onlyDateChanged({ fp: "x", date: "2026-11-01" }, { fp: "x", date: "2026-11-02" }, "date"), true);
  assert.equal(onlyDateChanged({ fp: "x", date: "2026-11-01" }, { fp: "y", date: "2026-11-02" }, "date"), false, "date and something else");
  assert.equal(onlyDateChanged({ fp: "x", date: "2026-11-01" }, { fp: "y", date: "2026-11-01" }, "date"), false, "no date change");
  for (const f of ["src/modules/sales/components/InvoiceForm.tsx", "src/modules/purchases/components/PurchaseForm.tsx"]) {
    const src = read(f);
    assert.match(src, /setAmendBaseline\(\{ fp: amendFingerprint, date: docDate \}\)/, `${f}: the baseline is taken when the amendment starts`);
    assert.match(src, /dateOnlyAmend\s*\?\s*t\("dateChange\.formRoute"\)/, `${f}: says so in the UI`);
    assert.match(src, /dateOnlyAmend && saved(Sale|Purchase)Id && amendBaseline\s*\? dateChange\.open\(/, `${f}: routes to the dialog`);
    assert.match(src, /: void persistDocument\("amend"\)/, `${f}: anything else is still an amendment`);
  }
  // The fingerprint holds what the amendment saves (lines, payments, people, totals, notes ...).
  const sale = read("src/modules/sales/components/InvoiceForm.tsx");
  for (const k of ["items", "payments", "selectedCustomerId", "effectiveSellerId", "totals", "notes", "additionalExpenses", "isOfficial", "vatMode"]) {
    assert.match(sale, new RegExp(`const amendFingerprint = JSON\\.stringify\\(\\{[\\s\\S]{0,400}\\b${k}\\b`), `sale fingerprint has ${k}`);
  }
});

// ── Texts ──────────────────────────────────────────────────────────────────

test("every issue code and dialog text exists in az, en and ru, in sentence case", () => {
  const keys = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [p + k] : keys(v, `${p}${k}.`))).sort();
  const base = keys(enMessages.dateChange);
  for (const m of [azMessages, ruMessages]) assert.deepEqual(keys(m.dateChange), base);
  for (const code of DATE_CHANGE_CODES) for (const m of [azMessages, enMessages, ruMessages]) assert.ok(m.dateChange.issues[code]?.trim(), code);
  for (const m of [azMessages, enMessages, ruMessages]) {
    for (const s of [m.dateChange.action, m.dateChange.check, m.dateChange.apply, m.settingsNav.dateChanges.title]) {
      assert.ok(s.trim());
      assert.notEqual(s, s.toUpperCase(), "not ALL CAPS");
    }
  }
  assert.equal(azMessages.dateChange.action, "Tarixi dəyiş");
  assert.equal(azMessages.dateChange.check, "Yoxla");
  assert.equal(azMessages.dateChange.apply, "Tətbiq et");
});

test("issue text: translated for known codes (with counts), the server's message otherwise; item lines", () => {
  const t = (k, p) => translate(enMessages, k, p);
  assert.equal(issueText({ code: "payments_move", message: "x", details: { count: 2 } }, t), "2 payment(s) made on the document's day move to the new date as well.");
  assert.equal(issueText({ code: "something_new", message: "Server text" }, t), "Server text");
  assert.deepEqual(issueItems({ code: "stock_negative", message: "", details: { items: [{ product: "MDF", warehouse: "Main", date: "2026-11-01", shortfall: 3 }] } }), ["MDF · Main · 01.11.2026 · −3"]);
  assert.equal(isoToDots("2026-11-01"), "01.11.2026");
});

// ── Flag, admin and wiring ─────────────────────────────────────────────────

test("DOC_DATE_CHANGE is off unless \"true\"", () => {
  assert.equal(isDocDateChangeEnabled({}), false);
  assert.equal(isDocDateChangeEnabled({ DOC_DATE_CHANGE: "TRUE " }), true);
  assert.equal(isDocDateChangeEnabled({ DOC_DATE_CHANGE: "1" }), false);
});

test("shown only with the flag AND an admin; posted invoices only", () => {
  const flag = read("src/components/documents/DocDateChangeFlag.tsx");
  assert.match(flag, /return flag && isAdmin;/);
  const hook = read("src/components/documents/DocumentDateChange.tsx");
  assert.match(hook, /allowed && posted \? \[\{ key: DATE_CHANGE_ACTION_KEY/);
  assert.match(read("src/app/layout.tsx"), /<DocDateChangeProvider enabled=\{isDocDateChangeEnabled\(\)\}>/);
  for (const [f, re] of [
    ["src/modules/sales/components/SalesScreen.tsx", /hidden: !\(dateChangeOn && status === "posted"\)/],
    ["src/modules/purchases/components/PurchasesScreen.tsx", /hidden: !\(dateChangeOn && r\.doc_status === "posted"\)/],
    ["src/modules/sales/components/SaleFormScreen.tsx", /dateChange\.formActions\(record\.doc_status === "posted"/],
    ["src/modules/purchases/components/PurchasesScreen.tsx", /dateChange\.formActions\(record\.doc_status === "posted"/],
    ["src/modules/sales/components/SalesPage.tsx", /dateChange\.allowed && isSalesPosted\(sale\.status\)/],
    ["src/modules/purchases/components/PurchasesPage.tsx", /dateChange\.allowed && normalizePurchaseDocumentStatus\(row\.status\) === "posted"/],
    ["src/modules/sales/components/SaleDetailPage.tsx", /dateChange\.allowed && sale && isSalesPosted\(sale\.status\)/],
    ["src/modules/purchases/components/PurchaseViewModal.tsx", /dateChange\.allowed && datePosted/],
  ]) assert.match(read(f), re, f);
  // The amend permission does not open the date change (admins only).
  assert.doesNotMatch(hook + flag, /can_edit_posted/);
});

test("history page: admins only, behind the flag", () => {
  const item = SETTINGS_ITEMS.find((i) => i.id === "date-changes");
  assert.ok(item);
  const access = { can: () => true, isAdmin: true, isEnabled: () => true, newUi: true, flags: { barcode: true, billing: true, newImports: true, docDateChange: true }, v2: false };
  assert.equal(settingsItemVisible(item, access), true);
  assert.equal(settingsItemVisible(item, { ...access, isAdmin: false }), false);
  assert.equal(settingsItemVisible(item, { ...access, flags: { ...access.flags, docDateChange: false } }), false);
  assert.match(read("src/app/settings/date-changes/page.tsx"), /if \(!isDocDateChangeEnabled\(\)\) notFound\(\);/);
  assert.match(read("src/modules/core/manifest.ts"), /prefix: "\/settings\/date-changes", permission: "can_manage_settings"/);
});

// ── The migration ──────────────────────────────────────────────────────────

test("migration: admin-only RPCs, history table with RLS, grants, no data changes", () => {
  const sql = read("supabase/migrations/20261110150000_document_date_change_core.sql");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.document_date_changes/);
  assert.match(sql, /reason\s+TEXT NOT NULL CHECK \(length\(btrim\(reason\)\) > 0\)/);
  assert.match(sql, /CREATE POLICY document_date_changes_select_admin[\s\S]{0,120}USING \(public\.user_is_admin\(\)\)/);
  assert.equal((sql.match(/IF NOT public\.user_is_admin\(\) THEN/g) ?? []).length, 2, "preview and apply check admin themselves");
  assert.doesNotMatch(sql, /has_permission\('can_edit_posted/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.apply_document_date_change\(TEXT, UUID, DATE, TEXT, JSONB, TEXT\[\]\) TO authenticated/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.apply_document_date_change\(TEXT, UUID, DATE, TEXT, JSONB, TEXT\[\]\) FROM PUBLIC, anon;/);
  assert.match(sql, /date_change:%s:%s:%s:%s/, "idempotency key");
  assert.doesNotMatch(sql, /^\s*(UPDATE|DELETE FROM|INSERT INTO) public\.(sales|purchases|journal_entries)\b(?![\s\S]*?\$\$)/m);
  // Wired into CI.
  assert.match(read(".github/workflows/db-baseline.yml"), /supabase\/tests\/document_date_change\.sql/);
});
