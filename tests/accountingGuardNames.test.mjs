// GUARD-2: the "Find duplicate or wrong names" drawer: how findings are shaped, the gates around the
// actions, the texts in az / en / ru, and that the migration and the drawer agree on the kinds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NAME_KINDS,
  NAME_RULES,
  REASON_MIN_LENGTH,
  guardFindingHref,
  isNameRule,
  nameCardFromJson,
  nameFindingFromRow,
  normalizeReason,
  openNameFindings,
  productCardHref,
  sortNameFindings,
} from "../src/lib/guard/nameFindings.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const MIGRATION = "supabase/migrations/20261120110000_accounting_guard_products.sql";

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const card = (id, name, extra = {}) => ({ id, code: `C-${name}`, name, unit: "əd", category: "Cat", stock: 4, last_movement: "2026-11-01T10:00:00Z", ...extra });
const row = (over = {}) => ({
  id: "00000000-0000-0000-0000-0000000000f1",
  rule_code: "F2",
  severity: "medium",
  status: "open",
  note: null,
  details: { kind: "similar_name", products: [card(A, "Konik bar"), card(B, "konik  bar")] },
  ...over,
});

test("a finding row becomes a drawer item with product cards", () => {
  const f = nameFindingFromRow(row());
  assert.equal(f.rule, "F2");
  assert.equal(f.kind, "similar_name");
  assert.equal(f.status, "open");
  assert.equal(f.products.length, 2);
  assert.deepEqual(f.products[0], { id: A, code: "C-Konik bar", name: "Konik bar", unit: "əd", category: "Cat", stock: 4, lastMovement: "2026-11-01T10:00:00Z" });
});

test("cards: missing values stay null, a card without an id is dropped", () => {
  assert.deepEqual(nameCardFromJson({ id: A, code: "X", name: "N", unit: " ", category: null, stock: "7.5", last_movement: null }), {
    id: A, code: "X", name: "N", unit: null, category: null, stock: 7.5, lastMovement: null,
  });
  assert.equal(nameCardFromJson({ code: "X" }), null);
  assert.equal(nameCardFromJson(null), null);
  assert.equal(nameCardFromJson("x"), null);
});

test("rows of other rules, without products or with an unknown status are dropped", () => {
  assert.equal(nameFindingFromRow(row({ rule_code: "E1" })), null);
  assert.equal(nameFindingFromRow(row({ rule_code: "F4" })), null);
  assert.equal(nameFindingFromRow(row({ status: "weird" })), null);
  assert.equal(nameFindingFromRow(row({ details: { kind: "similar_name", products: [] } })), null);
  assert.equal(nameFindingFromRow(row({ details: {} })), null);
  assert.equal(nameFindingFromRow(row({ id: 5 })), null);
  // An unknown kind on F1 / F2 falls back to the rule's own; on F3 / F5 the row is dropped.
  assert.equal(nameFindingFromRow(row({ details: { kind: "new_kind", products: [card(A, "x")] } })).kind, "similar_name");
  assert.equal(nameFindingFromRow(row({ rule_code: "F3", details: { kind: "new_kind", products: [card(A, "x")] } })), null);
  for (const rule of NAME_RULES) assert.ok(isNameRule(rule));
  assert.ok(!isNameRule("F4") && !isNameRule(undefined));
});

test("only open and acknowledged findings are listed, worst first", () => {
  const rows = [
    row({ id: "1", rule_code: "F3", severity: "low", details: { kind: "name_spaces", products: [card(A, "Zeta")] } }),
    row({ id: "2", rule_code: "F2", severity: "medium", details: { kind: "similar_name", products: [card(A, "Beta"), card(B, "beta ")] } }),
    row({ id: "3", rule_code: "F5", severity: "high", details: { kind: "duplicate_code", products: [card(A, "Alfa"), card(B, "Alfa 2")] } }),
    row({ id: "4", rule_code: "F1", severity: "medium", details: { kind: "same_name", products: [card(A, "Alfa"), card(B, "alfa")] } }),
    row({ id: "5", status: "false_positive" }),
    row({ id: "6", status: "resolved" }),
    row({ id: "7", status: "auto_resolved" }),
    row({ id: "8", status: "acknowledged", rule_code: "F2", severity: "medium", details: { kind: "similar_name", products: [card(A, "Aaa"), card(B, "aaa ")] } }),
  ];
  assert.deepEqual(openNameFindings(rows).map((f) => f.id), ["3", "4", "8", "2", "1"]);
  // Sorting does not change its input.
  const list = openNameFindings(rows);
  const copy = [...list];
  sortNameFindings(list);
  assert.deepEqual(list, copy);
});

test("links: the product card, the finding in the guard section", () => {
  assert.equal(productCardHref(A), `/products?highlight=${A}`);
  assert.equal(guardFindingHref(A), `/finance/guard?tab=findings&finding=${A}`);
  assert.equal(productCardHref("a b"), "/products?highlight=a%20b");
});

test("the reason of 'Not a duplicate' is required: trimmed, collapsed, at least three characters", () => {
  assert.equal(REASON_MIN_LENGTH, 3);
  assert.equal(normalizeReason("  Two   sizes\nof the bar  "), "Two sizes of the bar");
  assert.equal(normalizeReason("ab"), null);
  assert.equal(normalizeReason("   "), null);
  assert.equal(normalizeReason(undefined), null);
  assert.equal(normalizeReason(12345), null);
  assert.equal(normalizeReason("x".repeat(600)).length, 500);
});

test("the actions are admin only, behind the flag, and only call the guard functions", () => {
  const src = read("src/lib/actions/accountingGuard.ts");
  assert.match(src, /if \(!isAccountingGuardEnabled\(\)\) throw new ActionAuthError\("accountingGuard\.errors\.disabled"\);/);
  assert.match(src, /requirePermissionAction\("can_manage_settings"\)/);
  assert.match(src, /if \(!isAdminRole\(ctx\.profile\?\.role\)\) throw new ActionAuthError\("accountingGuard\.errors\.adminOnly"\);/);
  const exported = [...src.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(exported, ["scanProductNamesAction", "markNotDuplicateAction"]);
  // A "use server" file may export only async functions (and types): the build fails on any other export.
  assert.doesNotMatch(src, /^export (const|let|var|class|function) /m);
  for (const name of exported) {
    const body = src.slice(src.indexOf(`export async function ${name}`));
    const next = body.indexOf("\nexport ", 10);
    assert.match(next > 0 ? body.slice(0, next) : body, /requireGuardAdmin\(\)/, name);
  }
  // The admin's own session (so the database knows who), never the service role; no write other than the two functions.
  assert.doesNotMatch(src, /createSupabaseAdminClient/);
  assert.deepEqual([...src.matchAll(/\.rpc\("(\w+)"/g)].map((m) => m[1]).sort(), ["guard_scan", "guard_set_finding_status"]);
  assert.doesNotMatch(src, /\.(insert|update|delete|upsert)\(/);
  assert.match(src, /p_scope: \["products"\]/);
  assert.match(src, /p_status: "false_positive"/);
  assert.match(src, /"use server";/);
});

test("the button is for admins with the flag; it is on the product list and on Stock integrity, nowhere else", () => {
  const flag = read("src/components/guard/AccountingGuardFlag.tsx");
  assert.match(flag, /accountingGuardActive\(\{ enabled, isAdmin \}\)/);
  const button = read("src/components/guard/DuplicateNamesButton.tsx");
  assert.match(button, /if \(!active\) return null;/);
  assert.match(button, /StandardGrid/);
  assert.match(button, /from "@\/design-system\/components"/);
  assert.doesNotMatch(button, /ToastMessage|@\/components\/ui\/table|window\.(confirm|alert|prompt)/);
  assert.match(read("src/app/layout.tsx"), /<AccountingGuardProvider enabled=\{isAccountingGuardEnabled\(\)\}>/);
  assert.match(read("src/app/products/page.client.tsx"), /<DuplicateNamesButton \/>/);
  const integrity = read("src/modules/inventory/components/StockIntegrityPage.tsx");
  assert.equal([...integrity.matchAll(/<DuplicateNamesButton size="md" \/>/g)].length, 2, "both layouts of the page");
  // No merge, no delete: the drawer never calls a product action.
  assert.doesNotMatch(button, /deleteProduct|mergeProduct|fixStockIntegrity|entityDelete/);
});

function leaves(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) => (typeof v === "string" ? [`${prefix}${k}`] : leaves(v, `${prefix}${k}.`)));
}
function placeholders(text) {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}
function lookup(obj, path) {
  return path.split(".").reduce((o, k) => o?.[k], obj);
}

test("every text exists in az, en and ru with the same placeholders", () => {
  const base = leaves(enMessages.accountingGuard);
  assert.ok(base.length > 30);
  assert.deepEqual(leaves(azMessages.accountingGuard), base);
  assert.deepEqual(leaves(ruMessages.accountingGuard), base);
  for (const key of base) {
    const en = lookup(enMessages.accountingGuard, key);
    assert.deepEqual(placeholders(lookup(azMessages.accountingGuard, key)), placeholders(en), `az ${key}`);
    assert.deepEqual(placeholders(lookup(ruMessages.accountingGuard, key)), placeholders(en), `ru ${key}`);
    assert.notEqual(lookup(ruMessages.accountingGuard, key), en, `ru ${key} is not the English text`);
  }
});

test("texts follow the rulebook: one script per language, sentence case, no stray words", () => {
  const cyrillic = /[Ѐ-ӿ]/;
  for (const key of leaves(azMessages.accountingGuard)) {
    assert.doesNotMatch(lookup(azMessages.accountingGuard, key), cyrillic, `az ${key} has Cyrillic letters`);
  }
  for (const key of leaves(ruMessages.accountingGuard)) {
    // The rule codes ("F2") and numbers are the only Latin in the Russian texts.
    const text = lookup(ruMessages.accountingGuard, key).replace(/\{\w+\}/g, "");
    assert.doesNotMatch(text, /[A-Za-z]{3,}/, `ru ${key} has Latin words`);
  }
  for (const messages of [azMessages, enMessages, ruMessages]) {
    for (const key of leaves(messages.accountingGuard)) {
      const text = lookup(messages.accountingGuard, key);
      // Buttons and labels: no ALL CAPS words (TXT-1).
      assert.doesNotMatch(text.replace(/\{\w+\}/g, ""), /\b[A-ZƏÖÜŞÇĞİА-Я]{4,}\b/, key);
    }
  }
  assert.ok(lookup(enMessages.accountingGuard, "names.button").split(" ").length <= 5);
});

test("every kind the migration writes has a label, and the drawer knows every kind", () => {
  for (const messages of [azMessages, enMessages, ruMessages]) {
    assert.deepEqual(Object.keys(messages.accountingGuard.nameKinds).sort(), [...NAME_KINDS].sort());
  }
  const sql = read(MIGRATION);
  for (const kind of NAME_KINDS) assert.ok(sql.includes(`'${kind}'`) || sql.includes(`'duplicate_' || g.field`), `migration writes ${kind}`);
  assert.match(sql, /'duplicate_' \|\| g\.field/);
  // The rules the drawer lists are seeded under the category the button scans.
  for (const rule of NAME_RULES) assert.match(sql, new RegExp(`\\('${rule}', 'products'`), rule);
});

test("the guard section link is a route GUARD-3 builds; the texts name the Accounting Guard", () => {
  assert.match(enMessages.accountingGuard.names.openInGuard, /Accounting Guard/);
  assert.match(guardFindingHref(A), /^\/finance\/guard\?/);
});
