// Invoice payment dialog: the payment date can be today or any past day, never the future.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { todayLocalDate, validatePaymentDate } from "../src/lib/forms/paymentDate.ts";

test("todayLocalDate uses the local calendar day", () => {
  assert.equal(todayLocalDate(new Date(2026, 9, 3, 0, 30)), "2026-10-03");
  assert.equal(todayLocalDate(new Date(2026, 0, 31, 23, 59)), "2026-01-31");
});

test("past dates and today are accepted, future dates are refused", () => {
  assert.equal(validatePaymentDate("2026-10-14", "2026-10-17"), null);
  assert.equal(validatePaymentDate("2026-10-17", "2026-10-17"), null);
  assert.equal(validatePaymentDate("2026-10-18", "2026-10-17"), "date_in_future");
});

test("empty or invalid dates are refused", () => {
  assert.equal(validatePaymentDate("", "2026-10-17"), "date_required");
  assert.equal(validatePaymentDate("2026-02-30", "2026-10-17"), "date_required");
  assert.equal(validatePaymentDate("17.10.2026", "2026-10-17"), "date_required");
});

test("sales and purchase payments send the chosen date to the RPC", () => {
  for (const file of [
    "src/modules/sales/lib/recordSalePayment.ts",
    "src/modules/purchases/lib/recordPurchasePayment.ts",
  ]) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(src, /payment_date: input\.paymentDate/, file);
  }
});

test("the migration stores the date on the cash transaction and journal entry", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/20261017120000_invoice_payment_date.sql", import.meta.url),
    "utf8"
  );
  assert.match(sql, /p_payload->>'payment_date'/);
  assert.match(sql, /SET transaction_date = /);
  assert.match(sql, /SET entry_date = p_payment_date/);
});
