// View engine (prompt 17): view definitions, Studio fields, filters and search, sorting,
// grouping, pivot, graph, calendar, kanban moves, favourites, Excel rows, the CRM deals
// definition, and that nothing changes while NEW_UI is off.   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  accessFor,
  applySearch,
  calendarDays,
  calendarEvents,
  changedValues,
  COUNT_MEASURE,
  customValues,
  dateBucket,
  defaultFavorite,
  defaultSearchState,
  displayValue,
  EMPTY_GROUP,
  exportFileName,
  exportRows,
  graphSeries,
  groupRecords,
  kanbanColumns,
  kanbanKeyTarget,
  layoutOverlaps,
  matchesFilters,
  missingRequired,
  moveRecord,
  nextSort,
  parseGroupBy,
  parseInput,
  pivotTable,
  sanitizeSearchState,
  shiftAnchor,
  sortRecords,
  toggleGroupBy,
  validateDefinition,
  validFavoriteName,
  withStudioFields,
} from "../src/views/logic.ts";
import { DEALS_MODEL, dealFilters, dealFromRow, dealsDefinition } from "../src/modules/crm/views/deals.ts";
import { DEFAULT_CRM_CONFIG, parseCrmConfig } from "../src/modules/crm/lib/config.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

const t = (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key);
const fmt = { t, locale: "en" };
const customers = [
  { id: "c1", full_name: "Aysel", company_name: "Nur MMC" },
  { id: "c2", full_name: "Boris", company_name: null },
];
const def = dealsDefinition(DEFAULT_CRM_CONFIG, customers);
const ctx = { userId: "u1", now: new Date(2026, 9, 14, 12) };

const deal = (id, stage, value, extra = {}) => ({
  id,
  title: `Deal ${id}`,
  client_id: null,
  customer_name: null,
  stage,
  expected_value: value,
  assigned_to: null,
  salesperson: null,
  notes: null,
  production_order_id: null,
  created_at: "2026-10-10T09:00:00",
  updated_at: null,
  last_quote: null,
  quote_count: 0,
  ...extra,
});
const deals = [
  deal("a", "LEAD", 100, { assigned_to: "u1", client_id: "c1", customer_name: "Aysel", created_at: "2026-10-02T10:00:00" }),
  deal("b", "WON", 250.5, { client_id: "c2", customer_name: "Boris", last_quote: "TKL-1", created_at: "2026-09-20T10:00:00" }),
  deal("c", "LOST", 40, { created_at: "2026-10-12T08:30:00" }),
  deal("d", "PROPOSAL", 0, { assigned_to: "u1", title: "Şəki pəncərə", created_at: "2026-10-12T08:45:00" }),
  deal("e", "GONE", 10, { created_at: "2026-08-01T10:00:00" }),
];

// ── Definitions ──────────────────────────────────────────────────────────────

test("the CRM deals definition is valid, with its stages from the CRM settings", () => {
  assert.deepEqual(validateDefinition(def), []);
  const stage = def.fields.find((f) => f.name === "stage");
  assert.deepEqual(stage.options.map((o) => o.value), ["LEAD", "QUALIFIED", "PROPOSAL", "WON", "LOST"]);
  const custom = dealsDefinition(parseCrmConfig({ stages: [{ id: "NEW", label: "New", kind: "open" }, { id: "WON" }, { id: "LOST" }] }), []);
  assert.deepEqual(custom.fields.find((f) => f.name === "stage").options.map((o) => o.value), ["NEW", "WON", "LOST"]);
  assert.deepEqual(custom.kanban.folded, ["LOST"]);
  assert.deepEqual(validateDefinition(custom), []);
  // Done when: list, kanban and form.
  assert.ok(def.views.includes("list") && def.views.includes("kanban") && def.form);
  assert.equal(DEALS_MODEL.module, "crm");
  assert.equal(DEALS_MODEL.readPermission, "can_view_crm");
  assert.equal(DEALS_MODEL.writePermission, "can_manage_crm");
});

test("validateDefinition reports unknown fields, wrong kinds and missing view parts", () => {
  const bad = {
    ...def,
    views: ["list", "kanban", "calendar"],
    list: { columns: ["title", "nope"], sums: ["ghost"] },
    kanban: { ...def.kanban, groupBy: "expected_value" },
    form: { ...def.form, statusField: "title", tabs: [{ key: "x", labelKey: "x", fields: ["missing"] }] },
    calendar: { dateField: "title", title: "title" },
    pivot: { rows: "stage", measure: "title" },
  };
  const errors = validateDefinition(bad);
  for (const expected of ['list.columns: unknown field "nope"', 'list.sums: unknown field "ghost"', "kanban.groupBy: must be a selection field", "form.statusField: must be a selection field", 'form.tabs.x: unknown field "missing"', "calendar.dateField: must be a date field", 'measure "title": must be numeric']) {
    assert.ok(errors.includes(expected), `${expected} in ${JSON.stringify(errors)}`);
  }
  assert.ok(validateDefinition({ ...def, graph: undefined, views: ["graph"] }).includes('views: "graph" has no definition'));
  assert.ok(validateDefinition({ ...def, fields: [...def.fields, def.fields[0]] }).includes("fields: duplicate names"));
});

test("Studio custom fields appear as fields, list columns, a form tab, search and group by", () => {
  const base = { ...def, model: { ...def.model, studioModel: "customers" } };
  const studio = [
    { id: "1", model_key: "customers", name: "x_region", label: "Region", field_type: "selection", options: [{ value: "baku", label: "Bakı" }], required: true, show_in_list: true, help: "Where", sequence: 2, active: true },
    { id: "2", model_key: "customers", name: "x_vip", label: "VIP", field_type: "checkbox", options: [], required: false, show_in_list: false, help: null, sequence: 1, active: true },
    { id: "3", model_key: "customers", name: "x_old", label: "Old", field_type: "text", options: [], required: false, show_in_list: true, help: null, sequence: 0, active: false },
    { id: "4", model_key: "products", name: "x_other", label: "Other", field_type: "text", options: [], required: false, show_in_list: true, help: null, sequence: 0, active: true },
  ];
  const merged = withStudioFields(base, studio);
  assert.deepEqual(validateDefinition(merged), []);
  const added = merged.fields.filter((f) => f.custom);
  assert.deepEqual(added.map((f) => [f.name, f.type]), [["x_vip", "boolean"], ["x_region", "selection"]]);
  assert.equal(added[1].required, true);
  assert.equal(added[1].help, "Where");
  assert.deepEqual(merged.list.columns.slice(-1), ["x_region"]);
  assert.deepEqual(merged.form.tabs.at(-1).fields, ["x_vip", "x_region"]);
  assert.deepEqual(merged.groupBys.slice(-2), ["x_vip", "x_region"]);
  // A model without Studio, or no active fields: the definition is unchanged.
  assert.equal(withStudioFields(def, studio), def);
  assert.equal(withStudioFields(base, []), base);
  // Values come from custom_fields; archived and unknown keys stay out.
  assert.deepEqual(customValues({ custom_fields: { x_region: "baku", x_old: "hidden", x_bad: 1 } }, studio.filter((f) => f.active)), { x_region: "baku", x_vip: null, x_other: null });
  assert.deepEqual(customValues({ custom_fields: null }, [studio[1]]), { x_vip: null });
  // Search finds a custom selection by its label.
  const rec = { id: "r", title: "x", x_region: "baku" };
  assert.equal(applySearch([rec], merged, { search: "baki", filters: [] }, ctx, fmt).length, 1);
});

// ── Access ───────────────────────────────────────────────────────────────────

test("access: nothing while the module is off; admins everything; others by permission", () => {
  const model = { module: "crm", readPermission: "can_view_crm", writePermission: "can_manage_crm" };
  const user = (enabled, isAdmin, perms) => ({ isEnabled: (m) => enabled.includes(m), isAdmin, can: (p) => perms.includes(p) });
  assert.deepEqual(accessFor(model, user([], true, [])), { read: false, write: false });
  assert.deepEqual(accessFor(model, user(["crm"], true, [])), { read: true, write: true });
  assert.deepEqual(accessFor(model, user(["crm"], false, ["can_view_crm"])), { read: true, write: false });
  assert.deepEqual(accessFor(model, user(["crm"], false, ["can_view_crm", "can_manage_crm"])), { read: true, write: true });
  assert.deepEqual(accessFor(model, user(["crm"], false, ["can_manage_crm"])), { read: false, write: false });
  assert.deepEqual(accessFor({ ...model, writePermission: undefined }, user(["crm"], false, ["can_view_crm"])), { read: true, write: false });
});

// ── Filters and search ───────────────────────────────────────────────────────

test("filters: OR inside a group, AND between groups; dates compare as time", () => {
  const filters = dealFilters(DEFAULT_CRM_CONFIG);
  const ids = (active) => deals.filter((d) => matchesFilters(d, filters, active, ctx)).map((d) => d.id);
  assert.deepEqual(ids([]), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(ids(["mine"]), ["a", "d"]);
  assert.deepEqual(ids(["won", "lost"]), ["b", "c"]);
  assert.deepEqual(ids(["open"]), ["a", "d"]);
  assert.deepEqual(ids(["mine", "won"]), []);
  assert.deepEqual(ids(["this_month"]), ["a", "c", "d"]);
  assert.deepEqual(ids(["with_quote"]), ["b"]);
  assert.deepEqual(ids(["unknown-filter"]), ["a", "b", "c", "d", "e"]);
  // Signed out: "mine" matches nobody instead of everyone without an owner.
  assert.deepEqual(deals.filter((d) => matchesFilters(d, filters, ["mine"], { ...ctx, userId: null })).map((d) => d.id), []);
});

test("search: every word, accents and İ/ı/ə insensitive, through customer names and stage labels", () => {
  const ids = (search) => applySearch(deals, def, { search, filters: [] }, ctx, fmt).map((d) => d.id);
  assert.deepEqual(ids("seki"), ["d"]);
  assert.deepEqual(ids("ŞƏKİ PƏNCƏRƏ"), ["d"]);
  assert.deepEqual(ids("boris"), ["b"]);
  assert.deepEqual(ids("tkl-1"), ["b"]);
  assert.deepEqual(ids("deal won"), []);
  assert.deepEqual(ids("  "), ["a", "b", "c", "d", "e"]);
});

// ── Sorting ──────────────────────────────────────────────────────────────────

test("sorting: numbers, dates, stage order and names; empty values last; header cycle", () => {
  const order = (field, dir) => sortRecords(deals, def, { field, dir }).map((d) => d.id).join("");
  assert.equal(order("expected_value", "asc"), "decab");
  assert.equal(order("expected_value", "desc"), "baced");
  assert.equal(order("created_at", "asc"), "ebacd");
  assert.equal(order("stage", "asc"), "adbce");
  assert.equal(order("client_id", "asc"), "abcde");
  assert.equal(order("client_id", "desc"), "bacde");
  assert.equal(sortRecords(deals, def, null).map((d) => d.id).join(""), "abcde");
  assert.deepEqual(nextSort(null, "title"), { field: "title", dir: "asc" });
  assert.deepEqual(nextSort({ field: "title", dir: "asc" }, "title"), { field: "title", dir: "desc" });
  assert.equal(nextSort({ field: "title", dir: "desc" }, "title"), null);
  assert.deepEqual(nextSort({ field: "title", dir: "desc" }, "stage"), { field: "stage", dir: "asc" });
});

// ── Grouping ─────────────────────────────────────────────────────────────────

test("group by stage: option order, counts, sums, unknown stages in their own group", () => {
  const groups = groupRecords(deals, def, ["stage"], ["expected_value"], fmt);
  assert.deepEqual(groups.map((g) => [g.key, g.count, g.sums.expected_value]), [["LEAD", 1, 100], ["PROPOSAL", 1, 0], ["WON", 1, 250.5], ["LOST", 1, 40], ["GONE", 1, 10]]);
  assert.equal(groups[0].label, "Lead");
  assert.equal(groups[0].color, "#38bdf8");
});

test("nested group by with date buckets, empty group last and unique paths", () => {
  const groups = groupRecords(deals, def, ["created_at:month", "client_id"], ["expected_value"], fmt);
  assert.deepEqual(groups.map((g) => g.key), ["2026-08", "2026-09", "2026-10"]);
  const oct = groups[2];
  assert.equal(oct.count, 3);
  assert.equal(oct.sums.expected_value, 140);
  assert.match(oct.label, /October 2026/);
  assert.deepEqual(oct.children.map((g) => g.key), ["c1", EMPTY_GROUP]);
  assert.equal(oct.children[0].label, "Aysel");
  assert.equal(oct.children[1].label, "views.none");
  assert.equal(oct.children[1].path, "created_at=2026-10/client_id=__none");
  assert.deepEqual(parseGroupBy("created_at:quarter"), { field: "created_at", granularity: "quarter" });
  assert.deepEqual(parseGroupBy("stage"), { field: "stage", granularity: null });
  assert.equal(dateBucket("2026-10-14", "week"), "2026-W42");
  assert.equal(dateBucket("2026-01-01", "week"), "2026-W01");
  assert.equal(dateBucket("2027-01-01", "week"), "2026-W53");
  assert.equal(dateBucket("2026-11-30T10:00:00", "quarter"), "2026-Q4");
  assert.equal(dateBucket("not a date", "month"), null);
  assert.deepEqual(groupRecords(deals, def, [], [], fmt), []);
  assert.deepEqual(toggleGroupBy(["a", "b", "c"], "d"), ["a", "b", "c"]);
  assert.deepEqual(toggleGroupBy(["a", "b"], "a"), ["b"]);
});

// ── Pivot and graph ──────────────────────────────────────────────────────────

test("pivot: cells, row and column totals and the grand total agree", () => {
  const p = pivotTable(deals, def, "stage", "created_at:month", "expected_value", fmt);
  assert.deepEqual(p.rows.map((r) => r.key), ["LEAD", "PROPOSAL", "WON", "LOST", "GONE"]);
  assert.deepEqual(p.cols.map((c) => c.key), ["2026-08", "2026-09", "2026-10"]);
  assert.deepEqual(p.cells[0], [null, null, 100]);
  assert.deepEqual(p.cells[2], [null, 250.5, null]);
  assert.deepEqual(p.colTotals, [10, 250.5, 140]);
  assert.deepEqual(p.rowTotals, [100, 0, 250.5, 40, 10]);
  assert.equal(p.total, 400.5);
  const counts = pivotTable(deals, def, "stage", null, COUNT_MEASURE, fmt);
  assert.deepEqual(counts.cols.map((c) => c.key), ["__all"]);
  assert.equal(counts.total, 5);
  assert.deepEqual(counts.colTotals, [5]);
});

test("graph series per group, with stage colours", () => {
  const s = graphSeries(deals, def, "stage", COUNT_MEASURE, fmt);
  assert.deepEqual(s.map((p) => [p.key, p.value]), [["LEAD", 1], ["PROPOSAL", 1], ["WON", 1], ["LOST", 1], ["GONE", 1]]);
  assert.equal(s[2].color, "#34d399");
  assert.deepEqual(graphSeries(deals, def, "client_id", "expected_value", fmt).map((p) => p.value), [100, 250.5, 50]);
});

// ── Calendar ─────────────────────────────────────────────────────────────────

test("calendar ranges: a day, Monday to Sunday, whole weeks of the month; prev/next", () => {
  const wed = new Date(2026, 9, 14, 15);
  assert.equal(calendarDays("day", wed).length, 1);
  const week = calendarDays("week", wed);
  assert.equal(week.length, 7);
  assert.equal(week[0].getDay(), 1);
  assert.equal(week[0].getDate(), 12);
  const month = calendarDays("month", wed);
  assert.equal(month.length % 7, 0);
  assert.equal(month[0].getDay(), 1);
  assert.ok(month.some((d) => d.getMonth() === 9 && d.getDate() === 1));
  assert.ok(month.some((d) => d.getMonth() === 9 && d.getDate() === 31));
  assert.equal(shiftAnchor("week", wed, 1).getDate(), 21);
  assert.equal(shiftAnchor("day", wed, -1).getDate(), 13);
  assert.equal(shiftAnchor("month", new Date(2026, 0, 31), 1).getMonth(), 1);
});

test("calendar events by day; overlapping events sit side by side", () => {
  const days = calendarDays("week", new Date(2026, 9, 14));
  const byDay = calendarEvents(deals, days, "created_at", undefined, 45);
  const monday = byDay.get("2026-10-12");
  assert.deepEqual(monday.map((e) => [e.record.id, e.col, e.cols]), [["c", 0, 2], ["d", 1, 2]]);
  assert.equal(monday[0].end.getTime() - monday[0].start.getTime(), 45 * 60000);
  assert.equal(byDay.get("2026-10-14").length, 0);
  const at = (h, m, h2, m2) => ({ start: new Date(2026, 0, 1, h, m), end: new Date(2026, 0, 1, h2, m2), col: 0, cols: 1 });
  const evs = layoutOverlaps([at(9, 0, 10, 0), at(9, 30, 11, 0), at(10, 0, 10, 30), at(12, 0, 13, 0)]);
  assert.deepEqual(evs.map((e) => [e.col, e.cols]), [[0, 2], [1, 2], [0, 2], [0, 1]]);
});

// ── Kanban ───────────────────────────────────────────────────────────────────

test("kanban: one column per stage with counts and sums; unknown stages land in the first column", () => {
  const stage = def.fields.find((f) => f.name === "stage");
  const cols = kanbanColumns(deals, stage, "expected_value", fmt);
  assert.deepEqual(cols.map((c) => [c.key, c.records.map((r) => r.id).join(""), c.sum]), [["LEAD", "ae", 110], ["QUALIFIED", "", 0], ["PROPOSAL", "d", 0], ["WON", "b", 250.5], ["LOST", "c", 40]]);
  const moved = moveRecord(deals, "a", "stage", "WON");
  assert.equal(moved.find((d) => d.id === "a").stage, "WON");
  assert.equal(deals.find((d) => d.id === "a").stage, "LEAD");
});

test("kanban keyboard moves: arrows step one column, Home/End jump, edges stop", () => {
  const keys = ["LEAD", "QUALIFIED", "PROPOSAL", "WON", "LOST"];
  assert.equal(kanbanKeyTarget(keys, "LEAD", "ArrowRight"), "QUALIFIED");
  assert.equal(kanbanKeyTarget(keys, "LEAD", "ArrowLeft"), null);
  assert.equal(kanbanKeyTarget(keys, "LOST", "ArrowRight"), null);
  assert.equal(kanbanKeyTarget(keys, "QUALIFIED", "End"), "LOST");
  assert.equal(kanbanKeyTarget(keys, "WON", "Home"), "LEAD");
  assert.equal(kanbanKeyTarget(keys, "LEAD", "Home"), null);
  assert.equal(kanbanKeyTarget(keys, "NOPE", "ArrowRight"), null);
  assert.equal(kanbanKeyTarget(keys, "LEAD", "a"), null);
});

// ── Favourites ───────────────────────────────────────────────────────────────

test("saved search state is cleaned against the current definition", () => {
  assert.deepEqual(defaultSearchState(def), { search: "", filters: [], groupBy: [], sort: null, view: "kanban" });
  assert.deepEqual(sanitizeSearchState(null, def), defaultSearchState(def));
  assert.deepEqual(sanitizeSearchState([], def), defaultSearchState(def));
  const s = sanitizeSearchState({ search: "x".repeat(300), filters: ["won", "gone", "won", 3], groupBy: ["stage", "title", "client_id", "assigned_to", "created_at:month"], sort: { field: "expected_value", dir: "desc" }, view: "pivot" }, def);
  assert.equal(s.search.length, 200);
  assert.deepEqual(s.filters, ["won"]);
  assert.deepEqual(s.groupBy, ["stage", "client_id", "assigned_to"]);
  assert.deepEqual(s.sort, { field: "expected_value", dir: "desc" });
  assert.equal(s.view, "pivot");
  assert.equal(sanitizeSearchState({ view: "form", sort: { field: "nope", dir: "asc" } }, def).view, "kanban");
  assert.equal(sanitizeSearchState({ sort: { field: "nope", dir: "asc" } }, def).sort, null);
  assert.equal(validFavoriteName("  Won   this month "), "Won this month");
  assert.equal(validFavoriteName("   "), null);
  assert.equal(validFavoriteName("x".repeat(81)), null);
  const favs = [{ id: "1", name: "a", isDefault: false, state: s }, { id: "2", name: "b", isDefault: true, state: s }];
  assert.equal(defaultFavorite(favs).id, "2");
  assert.equal(defaultFavorite([favs[0]]), null);
});

// ── Excel and display ────────────────────────────────────────────────────────

test("Excel rows: translated headers, numbers as numbers, names instead of ids", () => {
  const rows = exportRows(deals.slice(0, 2), def, def.list.columns, fmt);
  assert.deepEqual(rows[0], ["crm.deal.title", "crm.deal.client", "crm.engine.fields.salesperson", "crm.engine.fields.stage", "crm.engine.fields.lastQuote", "crm.deal.expectedValue", "crm.engine.fields.createdAt"]);
  assert.deepEqual(rows[1].slice(0, 6), ["Deal a", "Aysel", null, "Lead", null, 100]);
  assert.equal(rows[2][5], 250.5);
  assert.equal(exportFileName('CRM: "deals"/2026', new Date(2026, 9, 14)), "CRM_deals_2026-2026-10-14.xlsx");
});

test("display values by field type", () => {
  const f = (name) => def.fields.find((x) => x.name === name);
  assert.equal(displayValue(f("stage"), deals[1], fmt), "Won");
  assert.equal(displayValue(f("client_id"), deals[1], fmt), "Boris");
  assert.equal(displayValue(f("expected_value"), deals[1], fmt), "250.50 common.currency");
  assert.equal(displayValue(f("notes"), deals[1], fmt), "");
  assert.equal(displayValue({ name: "v", type: "boolean" }, { id: "x", v: true }, fmt), "views.yes");
});

// ── Form ─────────────────────────────────────────────────────────────────────

test("form: only changed editable fields are saved; required and number input", () => {
  const fields = def.fields;
  const original = deals[0];
  assert.deepEqual(changedValues(fields, original, { title: "Deal a", expected_value: 120, stage: "WON", notes: "" }), { expected_value: 120, notes: "" });
  assert.deepEqual(changedValues(fields, original, {}), {});
  assert.deepEqual(missingRequired(fields, { ...original, title: "  " }), ["title"]);
  assert.deepEqual(missingRequired(fields, original), []);
  const money = fields.find((x) => x.name === "expected_value");
  assert.equal(parseInput(money, "1 234,567"), 1234.57);
  assert.equal(parseInput(money, ""), null);
  assert.equal(parseInput(money, "abc"), null);
  assert.equal(parseInput({ name: "n", type: "integer" }, "7.9"), 7);
  assert.equal(parseInput({ name: "b", type: "boolean" }, true), true);
  assert.equal(parseInput(fields[0], "  keep spaces "), "  keep spaces ");
});

test("a deals row becomes a flat record with names and the latest quotation", () => {
  const r = dealFromRow({
    id: "x",
    title: "Kitchen",
    stage: null,
    expected_value: "12.5",
    client_id: "c1",
    customers: { full_name: "", company_name: "Nur MMC" },
    profiles: [{ full_name: "Leyla" }],
    quotations: [{ quote_number: "TKL-1", created_at: "2026-01-01" }, { quote_number: "TKL-2", created_at: "2026-02-01" }],
  });
  assert.equal(r.stage, "LEAD");
  assert.equal(r.expected_value, 12.5);
  assert.equal(r.customer_name, "Nur MMC");
  assert.equal(r.salesperson, "Leyla");
  assert.equal(r.last_quote, "TKL-2");
  assert.equal(r.quote_count, 2);
  assert.equal(dealFromRow({ id: "y" }).last_quote, null);
});

// ── NEW_UI off: nothing changes ──────────────────────────────────────────────

test("with NEW_UI off /crm renders exactly the classic pipeline and /crm/<id> is a 404", () => {
  const crm = read("src/app/crm/page.tsx");
  assert.match(crm, /if \(!isNewUiEnabled\(\)\) return <CrmPipelinePage \/>;/);
  const form = read("src/app/crm/[id]/page.tsx");
  assert.match(form, /if \(!isNewUiEnabled\(\) \|\| !isValidUuid\(id\)\) notFound\(\);/);
  // The engine is loaded lazily, and only for users of the new shell.
  const sw = read("src/app/crm/page.client.tsx");
  assert.match(sw, /if \(!active\) return <CrmPipelinePage \/>;/);
  // NEW_CRM (prompt 21) only chooses between the two new-shell screens.
  assert.match(sw, /return newCrm \? <CrmPipelineScreen \/> : <CrmDealsScreen \/>;/);
  assert.match(sw, /dynamic\(\(\) => import\("@\/modules\/crm\/pages"\)/);
  // The classic pipeline does not import the engine.
  assert.doesNotMatch(read("src/modules/crm/components/CrmPipelinePage.tsx"), /@\/views|DealsScreen/);
});

test("the favourites table is private per user and is the only table this task adds", () => {
  const files = readdirSync(join(root, "supabase/migrations")).filter((f) => f.includes("view_favorites"));
  assert.deepEqual(files, ["20261014110000_view_favorites.sql"]);
  const sql = read(`supabase/migrations/${files[0]}`);
  assert.equal((sql.match(/create table/gi) ?? []).length, 1);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /using \(user_id = auth\.uid\(\)\)\s+with check \(user_id = auth\.uid\(\)\)/);
  assert.match(sql, /where is_default/);
  assert.doesNotMatch(sql, /grant [^;]* to anon/);
});

// ── Texts ────────────────────────────────────────────────────────────────────

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test("every text the engine and the deals screens use exists in az, en and ru", () => {
  const files = [...walk(join(root, "src/views")), join(root, "src/modules/crm/views/deals.ts"), join(root, "src/modules/crm/components/DealsScreen.tsx"), join(root, "src/modules/crm/components/DealFormScreen.tsx")];
  const keys = new Set();
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/["'`]((?:views|crm|common)\.[A-Za-z0-9_.]+)["'`]/g)) keys.add(m[1]);
  }
  keys.delete("crm.deals"); // the view key, not a text
  for (const v of ["list", "kanban", "pivot", "graph", "calendar"]) keys.add(`views.viewTypes.${v}`);
  for (const g of ["day", "week", "month", "quarter", "year"]) keys.add(`views.granularity.${g}`);
  for (const m of ["day", "week", "month"]) keys.add(`views.calendar.${m}`);
  for (const g of ["bar", "line", "pie"]) keys.add(`views.graph.${g}`);
  const get = (messages, key) => key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), messages);
  assert.ok(keys.size > 90);
  for (const [name, messages] of [["az", azMessages], ["en", enMessages], ["ru", ruMessages]]) {
    const missing = [...keys].filter((k) => typeof get(messages, k) !== "string");
    assert.deepEqual(missing, [], `${name} misses ${missing.join(", ")}`);
  }
});
