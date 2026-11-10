// INV-4 (COUNT_TEAM): the client mapping of an inventory count's responsible people.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  canEditCountTeam,
  countTeamView,
  employeeOptionHint,
  mapEmployeeOptionRows,
  mapResponsibleRows,
  MAX_COUNT_TEAM,
  teamChanged,
  teamNames,
  teamText,
  withChosenOptions,
} from "../src/modules/inventory/lib/countTeam.ts";
import { isCountTeamEnabled } from "../src/lib/features/countTeam.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

const OPTIONS = mapEmployeeOptionRows([
  { id: "e1", full_name: "Əli Həsənov", employee_code: "E-001", position: "Anbardar", department: "Anbar" },
  { id: "e2", full_name: " Səbinə Qasımova ", employee_code: null, position: "Operator", department: null },
  { id: "e3", full_name: "", employee_code: "X" },
  { full_name: "No id" },
]);

// ── Flag ────────────────────────────────────────────────────────────────────

test("COUNT_TEAM is off unless the env value is true", () => {
  assert.equal(isCountTeamEnabled({}), false);
  assert.equal(isCountTeamEnabled({ COUNT_TEAM: "1" }), false);
  assert.equal(isCountTeamEnabled({ COUNT_TEAM: " True " }), true);
  assert.match(read("src/app/layout.tsx"), /<CountTeamProvider enabled=\{isCountTeamEnabled\(\)\}>/);
  assert.match(read(".env.saas.example"), /^COUNT_TEAM=$/m);
});

// ── Options and rows ────────────────────────────────────────────────────────

test("employee options: id and name required, text trimmed, no other fields", () => {
  assert.deepEqual(OPTIONS, [
    { id: "e1", full_name: "Əli Həsənov", employee_code: "E-001", position: "Anbardar", department: "Anbar" },
    { id: "e2", full_name: "Səbinə Qasımova", employee_code: null, position: "Operator", department: null },
  ]);
  assert.deepEqual(mapEmployeeOptionRows(null), []);
  assert.equal(employeeOptionHint(OPTIONS[0]), "E-001 · Anbardar · Anbar");
  assert.equal(employeeOptionHint(OPTIONS[1]), "Operator");
  assert.equal(employeeOptionHint({ employee_code: null, position: null, department: null }), undefined);
});

test("responsible rows read back with the employee name (object or array embed)", () => {
  assert.deepEqual(
    mapResponsibleRows([
      { employee_id: "e1", employees: { full_name: "Əli Həsənov" } },
      { employee_id: "e2", employees: [{ full_name: "Səbinə Qasımova" }] },
      { employee_id: "e9", employees: null },
    ]),
    [
      { employee_id: "e1", full_name: "Əli Həsənov" },
      { employee_id: "e2", full_name: "Səbinə Qasımova" },
    ]
  );
});

// ── ids ↔ names ─────────────────────────────────────────────────────────────

test("ids to names in the chosen order; duplicates and unknown ids dropped", () => {
  assert.deepEqual(teamNames(["e2", "e1", "e2", "nobody"], OPTIONS), ["Səbinə Qasımova", "Əli Həsənov"]);
  assert.deepEqual(teamNames([], OPTIONS), []);
});

test("the text written to responsible_name: names joined with \", \" (as the RPC), or null", () => {
  assert.equal(teamText(["Səbinə Qasımova", "Əli Həsənov"]), "Səbinə Qasımova, Əli Həsənov");
  assert.equal(teamText([]), null);
  assert.equal(teamText(["  "]), null);
  // The SQL function joins the same way.
  assert.match(read("supabase/migrations/20261110100000_inventory_count_responsibles.sql"), /string_agg\(e\.full_name, ', ' ORDER BY t\.ord\)/);
});

test("people already on a count stay in the list after leaving HR, sorted by name", () => {
  const all = withChosenOptions(OPTIONS, [{ employee_id: "gone", full_name: "Çingiz Köhnə" }, { employee_id: "e1", full_name: "Əli Həsənov" }], "az");
  // Azerbaijani order: Ç before Ə before S.
  assert.deepEqual(all.map((o) => o.full_name), ["Çingiz Köhnə", "Əli Həsənov", "Səbinə Qasımova"]);
  assert.deepEqual(teamNames(["gone"], all), ["Çingiz Köhnə"]);
});

// ── Old free-text counts ────────────────────────────────────────────────────

test("an old count with only free text: no people, the text shown read-only", () => {
  assert.deepEqual(countTeamView({ responsible_name: "Əli və Səbinə", responsibles: [] }), { ids: [], names: [], legacyText: "Əli və Səbinə" });
  assert.deepEqual(countTeamView({ responsible_name: "  " }), { ids: [], names: [], legacyText: null });
});

test("a count with chosen people shows them; the joined text is not shown as legacy", () => {
  const view = countTeamView({
    responsible_name: "Əli Həsənov, Səbinə Qasımova",
    responsibles: [
      { employee_id: "e1", full_name: "Əli Həsənov" },
      { employee_id: "e2", full_name: "Səbinə Qasımova" },
    ],
  });
  assert.deepEqual(view, { ids: ["e1", "e2"], names: ["Əli Həsənov", "Səbinə Qasımova"], legacyText: null });
});

test("the RPC is called only when the set changed (order ignored)", () => {
  assert.equal(teamChanged(["e1", "e2"], ["e2", "e1"]), false);
  assert.equal(teamChanged(["e1"], ["e1", "e2"]), true);
  assert.equal(teamChanged(["e1"], []), true);
  assert.equal(teamChanged([], []), false);
});

test("who may change the people: same rules as the database", () => {
  assert.equal(canEditCountTeam("draft", false), true);
  assert.equal(canEditCountTeam("in_progress", false), true);
  assert.equal(canEditCountTeam("review", false), false);
  assert.equal(canEditCountTeam("posted", false), false);
  assert.equal(canEditCountTeam("review", true), true);
  assert.equal(canEditCountTeam("posted", true), true);
  const sql = read("supabase/migrations/20261110100000_inventory_count_responsibles.sql");
  assert.match(sql, /IF v_doc\.status IN \('review', 'posted'\) AND NOT v_admin THEN/);
  assert.match(sql, /cardinality\(v_ids\) > 50/);
  assert.equal(MAX_COUNT_TEAM, 50);
});

// ── Screens ─────────────────────────────────────────────────────────────────

test("flag off: the free-text field stays; flag on: the picker, in both forms", () => {
  const create = read("src/modules/inventory/components/InventoryCountsPage.tsx");
  assert.match(create, /\{countTeam \? \(\s*<div[\s\S]*?<CountTeamPicker[\s\S]*?\) : \(\s*<div>\s*<label className="erp-label">\{t\("inventoryCount\.responsible"\)\}<\/label>\s*<Input value=\{responsible\}/);
  assert.match(create, /\.\.\.\(countTeam \? \{ responsible_employee_ids: team \} : \{ responsible_name: responsible \}\)/);
  const detail = read("src/modules/inventory/components/InventoryCountDetailPage.tsx");
  assert.match(detail, /\{countTeam \? \(\s*<CountTeamPicker[\s\S]*?\) : \(\s*<Input\s+id="header-responsible"/);
  // With the flag on, the header save keeps the text; the people go through the RPC.
  assert.match(detail, /if \(countTeam && teamChanged\(countTeamView\(doc\)\.ids, headerForm\.team\)\)/);
});

test("the picker: design-system Combobox (multiple), chips, quick-create only with HR rights", () => {
  const picker = read("src/modules/inventory/components/CountTeamPicker.tsx");
  assert.match(picker, /<Combobox[\s\S]*?multiple=\{\{/);
  assert.match(picker, /canQuickCreate\("employee"/);
  assert.match(picker, /\{mayCreate \? <QuickCreateDialog entity="employee"/);
  assert.match(picker, /aria-label=\{t\("inventoryCount\.team\.remove", \{ name \}\)\}/);
  assert.match(picker, /const showLegacy = !!legacyText && value\.length === 0;/);
  // Accessibility: the old text and a load error describe the field; focus survives a chip removal.
  assert.match(picker, /\[describedBy, showLegacy \? legacyId : null, error \? errorId : null\]/);
  assert.match(picker, /<p id=\{errorId\} role="alert"/);
  assert.match(picker, /\(next \?\? document\.getElementById\(fieldId\)\)\?\.focus\(\)/);
  // Employees come from the RPC (names only), never from the employees table.
  const actions = read("src/modules/inventory/actions/inventoryCount.ts");
  assert.match(actions, /callRpc<unknown>\("inventory_count_employee_options", \{\}\)/);
  assert.match(actions, /callRpc<string \| null>\("inventory_count_set_responsibles"/);
  assert.doesNotMatch(picker, /from\("employees"\)/);
});

test("review fixes: read errors are not taken for \"no people\"; order kept; team saved first", () => {
  const actions = read("src/modules/inventory/actions/inventoryCount.ts");
  assert.match(actions, /if \(isMissingTable\(error\)\) return \[\];\s*throw new Error\(error\.message\);/);
  assert.match(actions, /\.order\("sort_order", \{ ascending: true \}\)/);
  // The limit is checked before a document number is taken.
  assert.ok(actions.indexOf("team.length > MAX_COUNT_TEAM") < actions.indexOf('callRpc<string>("next_inventory_count_doc_no"'));
  const sql = read("supabase/migrations/20261110100000_inventory_count_responsibles.sql");
  assert.match(sql, /ON CONFLICT \(count_id, employee_id\) DO UPDATE SET sort_order = EXCLUDED\.sort_order/);
  const detail = read("src/modules/inventory/components/InventoryCountDetailPage.tsx");
  assert.ok(detail.indexOf("setInventoryCountResponsiblesAction(countId, headerForm.team)") < detail.indexOf("updateInventoryCountHeaderAction(countId, {"), "people before header");
  assert.match(detail, /responsible_name: countTeam \? responsibleText : headerForm\.responsible_name/);
  // The employee list loads once per page, not on every open.
  assert.match(read("src/modules/inventory/components/CountTeamPicker.tsx"), /const needLoad = enabled && !state\.loaded && !state\.loading && !state\.error;/);
});

test("the texts exist in az, en and ru", () => {
  const keys = (o) => Object.keys(o).sort();
  const base = keys(enMessages.inventoryCount.team);
  for (const m of [azMessages, ruMessages]) assert.deepEqual(keys(m.inventoryCount.team), base);
  for (const m of [azMessages, enMessages, ruMessages]) {
    for (const k of base) assert.ok(m.inventoryCount.team[k].trim(), k);
    assert.match(m.inventoryCount.team.remove, /\{name\}/);
    assert.match(m.inventoryCount.team.max, /\{count\}/);
  }
});
