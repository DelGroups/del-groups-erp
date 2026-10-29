// Fix F1: backdated invoices and payments, admin edit of posted invoices.
// The database side is checked by supabase/tests/backdated_invoices.sql in CI.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  defaultPaymentDate,
  formatDayMonthYear,
  isBackdatedDocument,
  validatePaymentDate,
} from "../src/lib/forms/paymentDate.ts";
import { purchaseDocumentDate } from "../src/modules/purchases/lib/purchaseDates.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const MIGRATION = "supabase/migrations/20261029100000_backdated_invoices_payments.sql";

test("a payment can be dated from the invoice date to today, not earlier, not later", () => {
  const today = "2026-10-29";
  assert.equal(validatePaymentDate("2026-10-24", today, "2026-10-19"), null, "past, after the invoice");
  assert.equal(validatePaymentDate("2026-10-19", today, "2026-10-19"), null, "on the invoice date");
  assert.equal(validatePaymentDate("2026-10-18", today, "2026-10-19"), "before_document_date");
  assert.equal(validatePaymentDate("2026-10-30", today, "2026-10-19"), "date_in_future");
  assert.equal(validatePaymentDate("2026-10-10", today), null, "no invoice date known: only the future is refused");
  assert.equal(validatePaymentDate("2026-10-10", today, null), null);
});

test("the payment date defaults to today, or to the invoice date when that is later", () => {
  assert.equal(defaultPaymentDate("2026-10-19", "2026-10-29"), "2026-10-29");
  assert.equal(defaultPaymentDate(null, "2026-10-29"), "2026-10-29");
  assert.equal(defaultPaymentDate("2026-11-02", "2026-10-29"), "2026-11-02");
});

test("past-date note and date formatting", () => {
  assert.equal(isBackdatedDocument("2026-10-19", "2026-10-29"), true);
  assert.equal(isBackdatedDocument("2026-10-29", "2026-10-29"), false);
  assert.equal(isBackdatedDocument("", "2026-10-29"), false);
  assert.equal(formatDayMonthYear("2026-10-19"), "19.10.2026");
});

test("a purchase without doc_date is dated by the day it was created", () => {
  assert.equal(purchaseDocumentDate({ doc_date: "2026-10-19" }), "2026-10-19");
  assert.equal(purchaseDocumentDate({ doc_date: null, created_at: "2026-10-18T09:00:00+04:00" }), "2026-10-18");
  assert.equal(purchaseDocumentDate({}), null);
});

test("every payment dialog gets the invoice date", () => {
  for (const file of [
    "src/modules/sales/components/SalesPage.tsx",
    "src/modules/sales/components/SaleFormScreen.tsx",
    "src/modules/purchases/components/PurchasesPage.tsx",
    "src/modules/purchases/components/PurchasesScreen.tsx",
  ]) {
    assert.match(read(file), /documentDate=\{/, file);
  }
  const modal = read("src/components/documents/DocumentPaymentModal.tsx");
  assert.match(modal, /min=\{minDate\}/);
  assert.match(modal, /validatePaymentDate\(paymentDate, today, minDate\)/);
});

test("the migration dates records through one helper and keeps the closed-period guard", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.use_document_date/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.document_timestamp/);
  for (const table of ["journal_entries", "transactions", "stock_movements", "inventory_batches", "inventory_batch_consumptions"]) {
    assert.match(sql, new RegExp(`BEFORE INSERT ON public\\.${table}\\s+FOR EACH ROW EXECUTE FUNCTION public\\.apply_document_date\\(\\)`), table);
  }
  // The trigger name sorts before the period guard, so the guard sees the document date.
  assert.ok("trg_journal_entries_document_date" < "trg_journal_entries_period_guard");
  assert.doesNotMatch(sql, /FUNCTION public\.guard_journal_entry_period/);
  assert.doesNotMatch(sql, /FUNCTION public\.is_accounting_period_closed/);
  // Every posting path sets the document date.
  for (const fn of ["post_sales_invoice_draft", "process_sales_invoice_event", "post_purchase_invoice_draft", "process_purchase_receipt_event"]) {
    const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
    assert.ok(start > 0, fn);
    const body = sql.slice(start, sql.indexOf("$function$;", start));
    assert.match(body, /PERFORM public\.use_document_date\(/, fn);
  }
});

test("only admins (or a granted role) amend a posted invoice, in the database and the UI", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /public\.user_is_admin\(\) OR public\.has_permission\('can_edit_posted_sales'\)/);
  assert.match(sql, /public\.user_is_admin\(\) OR public\.has_permission\('can_edit_posted_purchases'\)/);
  // Cancel and amend share one reversal; cancel keeps its own permission check.
  assert.match(sql, /_reverse_sales_invoice_posting\(p_sale_id, v_label, v_reason, false\)/);
  assert.match(sql, /require_permission\('can_delete_sales'\)/);
  assert.match(read("src/modules/sales/manifest.ts"), /legacyKey: "can_edit_posted_sales"/);
  assert.match(read("src/modules/purchases/manifest.ts"), /legacyKey: "can_edit_posted_purchases"/);
  assert.match(read("src/modules/sales/components/InvoiceForm.tsx"), /can\("can_edit_posted_sales"\)/);
  assert.match(read("src/modules/purchases/components/PurchaseForm.tsx"), /can\("can_edit_posted_purchases"\)/);
  assert.match(read("src/modules/sales/lib/submitSale.ts"), /"amend_posted_sales_invoice"/);
  assert.match(read("src/modules/purchases/lib/submitPurchase.ts"), /"amend_posted_purchase_invoice"/);
  // The old browser-side edit of posted purchases is no longer used.
  assert.doesNotMatch(read("src/modules/purchases/components/PurchaseForm.tsx"), /updatePurchase\(/);
});

test("new texts exist in az, en and ru", () => {
  const keys = [
    ["modals", "payment", "beforeDocumentDate"],
    ["invoice", "pastDateNote"],
    ["invoice", "paymentDate"],
    ["invoice", "amend", "edit"],
    ["invoice", "amend", "warning"],
    ["invoice", "amend", "reason"],
    ["invoice", "amend", "save"],
    ["invoice", "amend", "saved"],
    ["invoice", "amend", "permissionSales"],
    ["invoice", "amend", "permissionPurchases"],
  ];
  for (const [lang, messages] of [["az", azMessages], ["en", enMessages], ["ru", ruMessages]]) {
    for (const path of keys) {
      const value = path.reduce((node, key) => node?.[key], messages);
      assert.equal(typeof value, "string", `${lang}.${path.join(".")}`);
    }
    assert.match(messages.modals.payment.beforeDocumentDate, /\{date\}/, `${lang} message names the invoice date`);
  }
});
