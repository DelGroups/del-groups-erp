import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildSearchFilter,
  joinHint,
  joinLabel,
  LOOKUP_LIMIT,
  mergeRecord,
  orderWithRecent,
  parseOptionalNumber,
  parseRecent,
  partyPayload,
  pushRecent,
  quickCreatePrefill,
  RECENT_LIMIT,
  recentStorageKey,
  restrictToIds,
  sanitizeSearchTerm,
  validateParty,
} from "../src/components/lookups/logic.ts";
import { LOOKUP_ENTITIES, LOOKUP_REGISTRY, canQuickCreate, entityNameKey, lookupQueryKey } from "../src/components/lookups/registry.ts";
import { azMessages } from "../src/i18n/messages/az.ts";
import { enMessages } from "../src/i18n/messages/en.ts";
import { ruMessages } from "../src/i18n/messages/ru.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ── Search ─────────────────────────────────────────────────────────────────────

test("search text is safe inside a PostgREST or-filter", () => {
  assert.equal(sanitizeSearchTerm("  Del, (Groups)*  "), "Del Groups");
  assert.equal(sanitizeSearchTerm("50%_off\\\""), "50 off");
  assert.equal(sanitizeSearchTerm("a".repeat(200)).length, 80);
  assert.equal(buildSearchFilter("", ["name"]), "");
  assert.equal(buildSearchFilter("  ", ["name"]), "");
  assert.equal(buildSearchFilter("MDF 18", ["name", "code"]), "name.ilike.*MDF 18*,code.ilike.*MDF 18*");
  // A comma typed by the user can never add another filter.
  assert.equal(buildSearchFilter("x,id.eq.1", ["name"]), "name.ilike.*x id.eq.1*");
  assert.equal(LOOKUP_LIMIT, 20);
});

test("recent picks come first, in recent order; the rest keep the database order", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  assert.deepEqual(orderWithRecent(rows, ["c", "x", "a"]).map((r) => r.id), ["c", "a", "b", "d"]);
  assert.deepEqual(orderWithRecent(rows, []).map((r) => r.id), ["a", "b", "c", "d"]);
});

test("the recent list moves a pick to the front and stays short", () => {
  assert.deepEqual(pushRecent(["a", "b"], "b"), ["b", "a"]);
  assert.deepEqual(pushRecent(["a", "b", "c", "d", "e"], "f"), ["f", "a", "b", "c", "d"]);
  assert.equal(pushRecent([], "x", RECENT_LIMIT).length, 1);
  assert.deepEqual(pushRecent(["a"], ""), ["a"]);
  assert.deepEqual(parseRecent('["a","b",3,""]'), ["a", "b"]);
  assert.deepEqual(parseRecent("{bad"), []);
  assert.deepEqual(parseRecent(null), []);
  assert.equal(recentStorageKey("supplier"), "erp.lookup.recent.supplier");
});

test("role scopes limit what can be picked", () => {
  const rows = [{ id: "w1" }, { id: "w2" }];
  assert.deepEqual(restrictToIds(rows, null).map((r) => r.id), ["w1", "w2"]);
  assert.deepEqual(restrictToIds(rows, ["w2"]).map((r) => r.id), ["w2"]);
  assert.deepEqual(restrictToIds(rows, []), []);
});

test("labels are one line: main text · second text", () => {
  assert.equal(joinLabel("Əli Həsənov", "Del Groups MMC"), "Əli Həsənov · Del Groups MMC");
  assert.equal(joinLabel("Del Groups", "del groups"), "Del Groups");
  assert.equal(joinLabel("", "Only company"), "Only company");
  assert.equal(joinHint(["SUP-1", "", null, "+994 50"]), "SUP-1 · +994 50");
  assert.equal(joinHint([null, ""]), undefined);
});

// ── Create, then select ────────────────────────────────────────────────────────

test("what was typed pre-fills the quick-create form", () => {
  assert.deepEqual(quickCreatePrefill("  Kamran   Əliyev "), { name: "Kamran Əliyev", phone: "" });
  assert.deepEqual(quickCreatePrefill("+994 50 123 45 67"), { name: "", phone: "+994 50 123 45 67" });
  assert.deepEqual(quickCreatePrefill(""), { name: "", phone: "" });
  assert.deepEqual(quickCreatePrefill("MDF 18"), { name: "MDF 18", phone: "" });
});

test("a party needs a name; a legal entity also a company and a VÖEN", () => {
  const base = { fullName: "Əli", companyName: "", phone: "", voen: "", legal: false };
  assert.equal(validateParty(base), null);
  assert.equal(validateParty({ ...base, fullName: "  " }), "lookup.errors.nameRequired");
  assert.equal(validateParty({ ...base, legal: true }), "lookup.errors.companyRequired");
  assert.equal(validateParty({ ...base, legal: true, companyName: "Del MMC" }), "lookup.errors.voenRequired");
  assert.equal(validateParty({ ...base, legal: true, companyName: "Del MMC", voen: "1234567891" }), null);
  const row = partyPayload({ ...base, fullName: " Əli ", phone: " 050 ", legal: true, companyName: "Del", voen: "123" }, "SUP", () => 0.5);
  assert.deepEqual(row, { code: "SUP-5500", full_name: "Əli", phone: "050", company_name: "Del", entity_type: "legal", voen: "123" });
  assert.equal(partyPayload(base, "CUST", () => 0).company_name, null);
});

test("the created record is merged into the form's own list and selected", () => {
  const list = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
  const created = { id: "c", name: "C" };
  const next = mergeRecord(list, created);
  assert.deepEqual(next.map((r) => r.id), ["c", "a", "b"]);
  // The form finds the selected record (VÖEN, credit limit) in its list straight away.
  assert.equal(next.find((r) => r.id === "c"), created);
  assert.deepEqual(mergeRecord(next, { id: "a", name: "A2" }).map((r) => r.name), ["A2", "C", "B"]);
});

test("typed numbers accept a comma and refuse negatives", () => {
  assert.equal(parseOptionalNumber("4,10"), 4.1);
  assert.equal(parseOptionalNumber(" "), null);
  assert.equal(parseOptionalNumber("-1"), null);
  assert.equal(parseOptionalNumber("abc"), null);
});

// ── Registry ───────────────────────────────────────────────────────────────────

test("every entity has a table, search columns and create permissions", () => {
  for (const entity of LOOKUP_ENTITIES) {
    const def = LOOKUP_REGISTRY[entity];
    assert.equal(def.entity, entity);
    assert.ok(def.table, entity);
    assert.ok(def.searchColumns.length > 0, entity);
    assert.ok(def.createPermissions.length > 0, entity);
    assert.ok(def.createPermissions.every((p) => p.startsWith("can_")), entity);
  }
  assert.deepEqual(LOOKUP_REGISTRY.expenseCategory.baseWhere, { type: "EXPENSE", is_active: true });
  assert.deepEqual(lookupQueryKey("supplier"), ["lookup", "supplier"]);
  assert.equal(entityNameKey("product"), "lookup.entities.product");
});

test("the + shows only for users who may create the entity, as on the full pages", () => {
  const user = (perms) => ({ isAdmin: false, can: (p) => perms.includes(p) });
  assert.equal(canQuickCreate("supplier", user(["can_manage_suppliers"])), true);
  assert.equal(canQuickCreate("supplier", user(["can_view_suppliers"])), false);
  assert.equal(canQuickCreate("customer", user(["can_manage_customers"])), true);
  assert.equal(canQuickCreate("product", user(["can_create_invoice"])), false);
  assert.equal(canQuickCreate("product", user(["can_manage_products"])), true);
  assert.equal(canQuickCreate("warehouse", user(["can_manage_warehouses"])), true);
  assert.equal(canQuickCreate("account", user(["can_manage_expenses"])), false);
  assert.equal(canQuickCreate("account", user(["can_manage_finance"])), true);
  assert.equal(canQuickCreate("employee", user(["can_manage_hr"])), true);
  // Expense categories follow quickCreateExpenseCategoryAction: any document writer.
  assert.equal(canQuickCreate("expenseCategory", user(["can_view_purchases"])), true);
  assert.equal(canQuickCreate("expenseCategory", user([])), false);
  // Admins always; a field can still turn creation off.
  assert.equal(canQuickCreate("product", { isAdmin: true, can: () => false }), true);
  assert.equal(canQuickCreate("product", { isAdmin: true, can: () => true }, false), false);
});

test("labels read the right columns: supplier company first, product stock in the hint", () => {
  assert.equal(LOOKUP_REGISTRY.supplier.label({ id: "1", full_name: "Əli", company_name: "Trans MMC" }), "Trans MMC · Əli");
  assert.equal(LOOKUP_REGISTRY.supplier.label({ id: "1", full_name: "Əli", company_name: "" }), "Əli");
  assert.equal(LOOKUP_REGISTRY.customer.label({ id: "1", full_name: "Əli", company_name: "Del" }), "Əli · Del");
  assert.equal(LOOKUP_REGISTRY.customer.hint({ id: "1", code: "CUST-1", phone: "050", voen: "123" }), "CUST-1 · 050 · VÖEN 123");
  assert.equal(LOOKUP_REGISTRY.product.hint({ id: "1", code: "P-1", stock: 12.5, unit: "Metr" }), "P-1 · 12.5 Metr");
  assert.equal(LOOKUP_REGISTRY.product.hint({ id: "1", code: "S-1", is_service: true, stock: 0, unit: "Ədəd" }), "S-1");
});

// ── i18n and wiring ────────────────────────────────────────────────────────────

test("lookup texts exist in az, en and ru for every entity", () => {
  const groups = ["entities", "create", "fields", "hints", "errors", "audit"];
  for (const g of groups) {
    const keys = Object.keys(azMessages.lookup[g]).sort();
    assert.deepEqual(Object.keys(enMessages.lookup[g]).sort(), keys, g);
    assert.deepEqual(Object.keys(ruMessages.lookup[g]).sort(), keys, g);
  }
  for (const entity of LOOKUP_ENTITIES) {
    for (const m of [azMessages, enMessages, ruMessages]) {
      assert.ok(m.lookup.entities[entity], entity);
      assert.ok(m.lookup.create[entity], entity);
    }
  }
  for (const k of ["createNamed", "dialogHint", "saveAndSelect", "saving", "created", "openFullForm"]) {
    for (const m of [azMessages, enMessages, ruMessages]) assert.ok(m.lookup[k], k);
  }
});

test("lookups stay behind UI_STANDARD in every wired form", () => {
  const audit = read("docs/lookup-audit.md");
  const wired = [...audit.matchAll(/`(src\/[^`]+\.tsx)`/g)].map((m) => m[1]);
  assert.ok(wired.length >= 10, "audit lists the wired forms");
  for (const file of new Set(wired)) {
    const src = read(file);
    if (!src.includes("EntityLookup")) continue;
    assert.ok(src.includes("useUiStandard"), `${file} switches on UI_STANDARD`);
  }
});
