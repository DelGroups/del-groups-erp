// FLT-1 / FLT-2: the "Filtrlər" control of the list toolbar: the dropdown menu of the fixed
// filters, with one submenu per value filter (INV-3); a bottom sheet with screens on phones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { activeFilterCount, clearAllFilters, personNameKey, pickedFirst, sanitizeSearchState, togglePick, valueFilterOptions, valueKeyResolver, withValueFilters } from "../src/views/logic.ts";
import { saleToRecord, salesDefinition, salesModel } from "../src/modules/sales/views/sales.ts";
import { purchasesDefinition, purchasesModel } from "../src/modules/purchases/views/purchases.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const model = { fetchAll: async () => [], fetchOne: async () => null };
const SALES = salesDefinition(salesModel(model));
const PURCHASES = purchasesDefinition(purchasesModel(model));
const FIXED = SALES.filters.map((f) => f.key);
const SELLER = SALES.valueFilters.find((vf) => vf.labelKey === "invoiceTools.filters.seller");
const MENU = read("src/views/components/FilterPanel.tsx");
const MENU_ROWS = read("src/views/components/Menu.tsx");

// ── Count and clear (FLT-1 helpers, kept) ─────────────────────────────────

test("active count: known fixed filters plus every value pick", () => {
  assert.equal(activeFilterCount(SALES, { filters: [] }), 0);
  assert.equal(activeFilterCount(SALES, { filters: [FIXED[0]] }), 1);
  assert.equal(activeFilterCount(SALES, { filters: [FIXED[0]], values: { seller_key: ["u-1", "u-2"], created_by: ["u-3"] } }), 4);
  assert.equal(activeFilterCount(SALES, { filters: ["nope"], values: {} }), 0);
});

test("active count: with INVOICE_TOOLS off, value picks do not count (no value filters)", () => {
  assert.equal(activeFilterCount(withValueFilters(SALES, false), { filters: [], values: { seller_key: ["u-1"] } }), 0);
  assert.equal(activeFilterCount(withValueFilters(SALES, true), { filters: [], values: { seller_key: ["u-1"] } }), 1);
});

test("clear all: drops fixed filters and value picks, keeps search, grouping, sort and view", () => {
  const state = { search: "abc", filters: [FIXED[0]], values: { seller_key: ["u-1"] }, groupBy: ["status"], sort: { field: "date", dir: "desc" }, view: "list" };
  assert.deepEqual(clearAllFilters(state), { search: "abc", filters: [], values: undefined, groupBy: ["status"], sort: { field: "date", dir: "desc" }, view: "list" });
});

// ── The menu ──────────────────────────────────────────────────────────────

test("the menu: fixed filters by group with separators, then one submenu per value filter, then clear", () => {
  const menu = MENU.slice(MENU.indexOf("function FilterMenu("), MENU.indexOf("const MENU_KEYS"));
  const order = ["Dropdown.Label", "groups.map", "<MenuCheck", "valueFilters.map", "<ValueSubmenu", 'fmt.t("views.clearFilters")'];
  let at = -1;
  for (const part of order) {
    const i = menu.indexOf(part, at + 1);
    assert.ok(i > at, `${part} after the previous part`);
    at = i;
  }
  assert.match(menu, /\{i \? <Dropdown\.Separator className="ds-menu-sep" \/> : null\}/, "a separator between groups");
  assert.match(menu, /\{active \? \(\s*<>\s*<Dropdown\.Separator/, "clear only when something is on");
  assert.doesNotMatch(menu, /overflow-y-auto|<h3/, "no inner scroll, no section headings in the main menu");
  // The groups of the sales menu, in order (Mənim fakturalarım, statuses, …, months).
  assert.deepEqual([...new Set(SALES.filters.map((f) => f.group))].length >= 3, true);
});

test("flag off: no value-filter items, the menu is the old one", () => {
  const off = withValueFilters(SALES, false);
  assert.equal(off.valueFilters, undefined);
  assert.deepEqual(off.filters.map((f) => f.key), FIXED);
  assert.match(MENU, /const valueFilters = def\.valueFilters \?\? \[\];[\s\S]*?\{valueFilters\.length \? \(/);
  assert.deepEqual(withValueFilters(PURCHASES, true).valueFilters.map((vf) => vf.labelKey), ["invoiceTools.filters.supplier", "invoiceTools.filters.responsible", "invoiceTools.filters.createdBy"]);
});

test("a value filter item: name with the picked count and a chevron; Radix submenu in the overlay layer", () => {
  assert.match(MENU, /count \? fmt\.t\("views\.valueFilters\.itemCount", \{ name, count \}\) : name/);
  for (const lang of [azMessages, enMessages, ruMessages]) {
    assert.equal(lang.views.valueFilters.itemCount.replace("{name}", "Satıcı").replace("{count}", "2"), "Satıcı (2)");
  }
  assert.match(MENU, /<Dropdown\.Sub>/);
  assert.match(MENU, /<Dropdown\.SubTrigger[\s\S]{0,400}<ChevronRight/);
  assert.match(MENU, /<Dropdown\.Portal container=\{portalContainer \?\? undefined\}>\s*<Dropdown\.SubContent\s+sideOffset=\{4\}\s+collisionPadding=\{12\}/, "portalled, flips near the edge");
  // OVL-2: the submenu is never taller than the free space and only its list scrolls.
  assert.match(MENU, /maxHeight: "min\(28rem, var\(--radix-dropdown-menu-content-available-height/);
  assert.match(MENU, /data-value-list=""/);
});

test("the submenu: search box first, typeahead does not eat its keys, ticks keep it open", () => {
  const sub = MENU.slice(MENU.indexOf("function ValueSubmenu("), MENU.indexOf("// ── Phones"));
  assert.ok(sub.indexOf('type="search"') < sub.indexOf("<MenuCheck"), "search above the list");
  assert.match(MENU, /const MENU_KEYS = new Set\(\["ArrowDown", "Escape", "Tab"\]\);/);
  assert.match(sub, /if \(!MENU_KEYS\.has\(e\.key\)\) e\.stopPropagation\(\);/);
  assert.match(MENU_ROWS, /onSelect=\{\(e\) => e\.preventDefault\(\)\}/, "ticking keeps the menu open");
  // A pointer move over the list does not pull the focus out of the search while typing.
  assert.match(sub, /if \(document\.activeElement === searchRef\.current\) e\.preventDefault\(\);/);
  assert.match(sub, /onPointerMove=\{keepSearchFocus\}/);
  // Counts are read out with their unit ("9 qeyd"), the bare number is hidden from readers.
  assert.match(sub, /countLabel=\{t\("views\.records", \{ count: o\.count \}\)\}/);
  assert.match(MENU_ROWS, /\{countLabel \? <span className="sr-only">\{countLabel\}<\/span> : null\}/);
  assert.match(sub, /if \(e\.target === e\.currentTarget && viaKeyboard\.current\) searchRef\.current\?\.focus\(\);/, "keyboard open: focus the search");
  assert.match(sub, /\{picked\.length \? \([\s\S]{0,600}views\.valueFilters\.clearAll/, "clear all only when someone is picked");
});

// ── People: search, pick, order, duplicates ───────────────────────────────

const sale = (id, over = {}) => saleToRecord({ id, doc_no: `S-${id}`, status: "posted", total_amount: 1, paid_amount: 1, remaining_balance: 0, ...over });

test("picked people come first; then the rest in name order", () => {
  const options = [
    { value: "a", label: "Aynur", count: 2 },
    { value: "b", label: "Elvin", count: 1 },
    { value: "c", label: "Ömər", count: 3 },
  ];
  assert.deepEqual(pickedFirst(options, ["c"]).map((o) => o.value), ["c", "a", "b"]);
  assert.deepEqual(pickedFirst(options, ["c", "a"]).map((o) => o.value), ["a", "c", "b"], "several picked: in name order");
  assert.deepEqual(pickedFirst(options, []).map((o) => o.value), ["a", "b", "c"]);
});

test("submenu search matches the name and the second line, Azerbaijani letters included", async () => {
  const { filterOptions } = await import("../src/design-system/logic.ts");
  const options = [
    { value: "a", label: "Ulviyya Shahbazova", count: 9 },
    { value: "b", label: "Ömər Çələbiyev", count: 1, hint: "#a1b2c3" },
  ];
  assert.deepEqual(filterOptions(options, "ulv", "az").map((o) => o.value), ["a"]);
  assert.deepEqual(filterOptions(options, "ömər", "az").map((o) => o.value), ["b"]);
  assert.deepEqual(filterOptions(options, "a1b2", "az").map((o) => o.value), ["b"]);
});

test("names match whatever their case and spacing; I, İ, ı and i are one letter", () => {
  assert.equal(personNameKey("  Ulviyya   Shahbazova "), "ulviyya shahbazova");
  assert.equal(personNameKey("ULVİYYA SHAHBAZOVA"), personNameKey("ulviyya shahbazova"));
  assert.equal(personNameKey("ULVIYYA SHAHBAZOVA"), personNameKey("ulviyya shahbazova"), "ASCII I on a Latin keyboard");
  assert.equal(personNameKey("Ilkin"), personNameKey("İlkin"));
});

test("tick / untick one person keeps the other filters' picks", () => {
  const v = togglePick({ created_by: ["u-1"] }, "seller_key", "u-2");
  assert.deepEqual(v, { created_by: ["u-1"], seller_key: ["u-2"] });
  assert.deepEqual(togglePick(v, "seller_key", "u-3"), { created_by: ["u-1"], seller_key: ["u-2", "u-3"] }, "several");
  assert.deepEqual(togglePick(v, "seller_key", "u-2"), { created_by: ["u-1"] }, "the last one off drops the filter");
});

test("saved favourites keep working: seller_id picks become seller_key, old name keys are respelled", () => {
  const saved = { search: "", filters: [], values: { seller_id: ["emp-1"], created_by: ["name:Köhnə  Məsul"] }, groupBy: [], sort: null, view: "list" };
  const state = sanitizeSearchState(saved, SALES);
  assert.deepEqual(state.values, { seller_key: ["emp-1"], created_by: ["name:köhnə məsul"] });
  // An old invoice without an issuer name keeps seller_id as its key, so the pick still matches it.
  assert.equal(sale("old", { seller_id: "emp-1", seller_name: "Ali" }).seller_key, "emp-1");
});

test("the list order is fixed when it opens: a tick never moves the row under the pointer", () => {
  assert.match(MENU, /const \[pickedAtOpen\] = useState\(picked\);/);
  assert.match(MENU, /pickedFirst\(\[\.\.\.options, \.\.\.extra\], pickedAtOpen\)/);
  // The submenu body mounts each time the submenu opens (inside SubContent).
  assert.match(MENU, /<Dropdown\.SubContent[\s\S]{0,1200}<SubmenuBody /);
});

test("phones: Clear filters keeps the focus in the list", () => {
  assert.match(MENU, /onChange\(clearAllFilters\(state\)\);\s*\/\/ The button goes away[\s\S]{0,200}requestAnimationFrame/);
});

test("item 7: one issuer selling for several sellers is ONE choice (key = the person the label names)", () => {
  // Before FLT-2 the key was seller_id but the label the issuer's name: three rows "Ulviyya".
  const rows = [
    ...Array.from({ length: 9 }, (_, i) => sale(`a${i}`, { seller_id: "emp-1", seller_name: "Ulviyya Shahbazova", issued_by: "u-ulviyya", issued_by_name: "ulviyya shahbazova" })),
    sale("b", { seller_id: "emp-2", seller_name: "Rəşad", issued_by: "u-ulviyya", issued_by_name: "ulviyya shahbazova" }),
    sale("c", { seller_id: null, seller_name: "Elvin", issued_by: "u-ulviyya", issued_by_name: "ulviyya shahbazova" }),
  ];
  const options = valueFilterOptions(rows, SELLER, "?", "az");
  assert.deepEqual(options.map((o) => [o.value, o.label, o.count]), [["u-ulviyya", "ulviyya shahbazova", 11]]);
  assert.equal(options[0].hint, undefined);
  // A stored seller name that differs only in case or spaces joins the id that has it.
  const old = [sale("x", { seller_id: "emp-9", seller_name: "Aynur Əliyeva" }), sale("y", { seller_id: null, seller_name: " aynur  əliyeva" })];
  assert.deepEqual(valueFilterOptions(old, SELLER, "?", "az").map((o) => [o.value, o.count]), [["emp-9", 2]]);
  assert.equal(valueKeyResolver(old, SELLER)(old[1]), "emp-9");
});

test("item 7: two different users with the same name stay apart, each with a muted id line", () => {
  const rows = [
    sale("a", { created_by: "11111111-2222-3333-4444-aaaaaabbbbbb", created_by_name: "Ulviyya Shahbazova" }),
    sale("b", { created_by: "99999999-8888-7777-6666-cccccc000001", created_by_name: "ulviyya shahbazova" }),
  ];
  const creator = SALES.valueFilters.find((vf) => vf.field === "created_by");
  const options = valueFilterOptions(rows, creator, "?", "az");
  assert.equal(options.length, 2);
  assert.deepEqual(options.map((o) => o.hint).sort(), ["#000001", "#bbbbbb"]);
  // Different names get no second line.
  assert.equal(valueFilterOptions([rows[0]], creator, "?", "az")[0].hint, undefined);
  assert.match(MENU_ROWS, /\{hint \? <span className="truncate text-\[length:var\(--ds-text-xs\)\] ds-muted">\{hint\}<\/span> : null\}/);
});

test("the sales record keys the seller filter on the issuer when the issuer's name is shown", () => {
  assert.equal(sale("1", { seller_id: "emp-1", seller_name: "Ali", issued_by: "u-1", issued_by_name: "Ali Əliyev" }).seller_key, "u-1");
  assert.equal(sale("2", { seller_id: "emp-1", seller_name: "Ali", issued_by: "u-1", issued_by_name: null }).seller_key, "emp-1", "the stored seller's name is shown: its id");
  assert.equal(sale("3", { seller_id: null, seller_name: "Ali", issued_by: null }).seller_key, null);
  assert.equal(SELLER.field, "seller_key");
});

// ── Phones ────────────────────────────────────────────────────────────────

test("phones: the bottom sheet, fixed filters as a plain list, a value filter opens a second screen", () => {
  assert.match(MENU, /const PHONE = "\(max-width: 767\.98px\)"/);
  assert.match(MENU, /className="ds-sheet"/);
  assert.match(MENU, /data-sheet-value-filter=\{vf\.field\} onClick=\{\(\) => setScreen\(vf\.field\)\}/);
  assert.match(MENU, /\{current \? \(\s*<button type="button" className="ds-icon-btn" onClick=\{back\} aria-label=\{t\("views\.valueFilters\.back"\)\}/, "back arrow on the second screen");
  assert.match(MENU, /\{current \? t\(current\.labelKey\) : t\("views\.filters"\)\}/, "the title names the screen");
  assert.match(MENU, /<SheetPeople key=\{current\.field\}/, "a screen, not a section under the list");
  assert.match(MENU, /className="ds-menu-item min-h-10"/, "40 px rows on phones");
});

test("texts in az, en and ru, sentence case (TXT-1)", () => {
  for (const m of [azMessages, enMessages, ruMessages]) {
    for (const s of [m.views.clearFilters, m.views.filtersActive, m.views.valueFilters.searchIn, m.views.valueFilters.clearAll, m.views.valueFilters.back, m.views.valueFilters.menu]) {
      assert.ok(s?.trim());
      assert.notEqual(s, s.toUpperCase());
    }
  }
  assert.equal(azMessages.views.clearFilters, "Filtri təmizlə");
  assert.equal(azMessages.views.valueFilters.clearAll, "Hamısını təmizlə");
});
