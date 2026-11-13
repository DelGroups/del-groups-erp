// DATE-2: change the date of cash documents in place (DOC_DATE_CHANGE, admins): a payment booked
// on an invoice, a partner payment, a manual cash row and an expense.
// The SQL rules are tested in supabase/tests/document_date_change_cash.sql (CI: db-baseline).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  bakuIsoDate,
  DATE_CHANGE_CODES,
  DATE_CHANGE_DOCUMENT_TYPES,
  dateChangeAffectedKeys,
  dateChangePaymentsOption,
  isDateChangeDocumentType,
  issueText,
  parseResolvedDocument,
} from "../src/lib/documents/dateChange.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";
import { translate } from "../src/i18n/translate.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const MIGRATION = "supabase/migrations/20261110151000_document_date_change_cash.sql";

test("document types: the invoices and the four cash documents, nothing else", () => {
  assert.deepEqual([...DATE_CHANGE_DOCUMENT_TYPES], ["sale", "purchase", "invoice_payment", "partner_payment", "cash_transaction", "expense"]);
  assert.equal(isDateChangeDocumentType("expense"), true);
  assert.equal(isDateChangeDocumentType("transfer"), false, "transfers are not covered");
  assert.equal(isDateChangeDocumentType(null), false);
});

test("the payments option: invoices and expenses only; the dialog lists the counts that apply", () => {
  assert.equal(dateChangePaymentsOption("sale"), "invoice");
  assert.equal(dateChangePaymentsOption("purchase"), "invoice");
  assert.equal(dateChangePaymentsOption("expense"), "expense");
  for (const type of ["invoice_payment", "partner_payment", "cash_transaction"]) assert.equal(dateChangePaymentsOption(type), null, type);
  assert.ok(dateChangeAffectedKeys("sale").includes("stock_moves"));
  assert.deepEqual([...dateChangeAffectedKeys("expense")], ["journals", "cash"]);
  assert.deepEqual([...dateChangeAffectedKeys("partner_payment")], ["journals", "cash", "payments"]);
});

test("resolve: a cash row's document is parsed; anything else is null", () => {
  assert.deepEqual(parseResolvedDocument({ type: "partner_payment", id: "p1", label: "Acme · 60.00 AZN", date: "2026-11-01" }), {
    type: "partner_payment",
    id: "p1",
    label: "Acme · 60.00 AZN",
    date: "2026-11-01",
  });
  assert.deepEqual(parseResolvedDocument({ type: "expense", id: "e1" }), { type: "expense", id: "e1", label: "e1", date: null });
  assert.equal(parseResolvedDocument(null), null);
  assert.equal(parseResolvedDocument({ type: "transfer", id: "x" }), null);
  assert.equal(parseResolvedDocument({ type: "sale" }), null);
});

test("a payment's moment is shown as its Baku day", () => {
  assert.equal(bakuIsoDate("2026-11-01T21:30:00Z"), "2026-11-02", "after midnight in Baku");
  assert.equal(bakuIsoDate("2026-11-01T08:00:00Z"), "2026-11-01");
  assert.equal(bakuIsoDate("not a date"), null);
});

test("the new checks and texts exist in az, en and ru", () => {
  for (const code of ["payment_before_its_invoice", "reimbursement_before_expense", "expense_before_source"]) {
    assert.ok(DATE_CHANGE_CODES.includes(code), code);
    for (const m of [azMessages, enMessages, ruMessages]) assert.ok(m.dateChange.issues[code]?.trim(), code);
  }
  for (const m of [azMessages, enMessages, ruMessages]) {
    for (const type of DATE_CHANGE_DOCUMENT_TYPES) assert.ok(m.dateChange.history.types[type]?.trim(), type);
    for (const k of ["moveSameDayReimbursement", "moveSameDayReimbursementHint", "ledgerDone", "notResolvable"]) assert.ok(m.dateChange[k]?.trim(), k);
    assert.ok(m.dateChange.history.tables.payments?.trim());
  }
  const t = (k, p) => translate(enMessages, k, p);
  assert.equal(issueText({ code: "reimbursement_before_expense", message: "x" }, t), "The reimbursement to the employee would be dated before the expense:");
});

test("menus: expenses, partner payments and the cash ledger, only while allowed", () => {
  const screen = read("src/modules/expenses/components/ExpensesScreen.tsx");
  assert.match(screen, /hidden: !\(dateChangeOn && expenseIsBooked\(r\.status\)\)/);
  assert.match(screen, /dateChange\.formActions\(expenseIsBooked\(record\.status\), \{ type: "expense"/);
  assert.match(read("src/modules/expenses/components/ExpensesPage.tsx"), /hidden: !\(dateChange\.allowed && \(r\.status === "approved" \|\| r\.status === "posted"\)\)/);
  const payments = read("src/modules/accounting/components/PaymentsPage.tsx");
  assert.match(payments, /rowActions=\{dateChange\.allowed \? rowActions : undefined\}/);
  assert.match(payments, /type: "partner_payment"/);
  const ledger = read("src/modules/accounting/components/UnifiedLedgerRowActions.tsx");
  assert.match(ledger, /hidden: !dateChange\.allowed/);
  assert.match(ledger, /resolveDateChangeDocument\(transaction\.id\)/);
  // The dialog offers the payments option only where it means something.
  assert.match(read("src/components/documents/DocumentDateChange.tsx"), /\{paymentsOption \? \(/);
});

test("migration: every type checked by the same engine; admin-only resolve; module table guarded", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /to_regprocedure\('public\._date_change_rows\(text, uuid, date, jsonb\)'\) IS NULL/, "needs DATE-1");
  assert.equal((sql.match(/\('sale', 'purchase', 'invoice_payment', 'partner_payment', 'cash_transaction', 'expense'\)/g) ?? []).length, 2, "preview and apply accept the types");
  assert.equal((sql.match(/IF NOT public\.user_is_admin\(\) THEN/g) ?? []).length, 3, "preview, apply and resolve check admin");
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.resolve_date_change_document\(UUID\) TO authenticated/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\._date_change_set_header\(TEXT, UUID, DATE, DATE, JSONB, JSONB\) FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /IF to_regclass\('public\.expenses'\) IS NOT NULL/);
  assert.doesNotMatch(sql, /^\s*(UPDATE|DELETE FROM|INSERT INTO) public\.\w+[^$]*;\s*$(?![\s\S]*?\$\$)/m, "no data changes outside functions");
  assert.match(read(".github/workflows/db-baseline.yml"), /supabase\/tests\/document_date_change_cash\.sql/);
  assert.match(read("supabase/scripts/tenant1_preflight.sql"), /20261110151000_document_date_change_cash/);
});
