// Imports module (IMP-1): landed cost, CBAR rates, settings, drafts and the module wiring.
// The database side is checked by supabase/tests/imports_core.sql in CI.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { allocateCents, calculateLandedCost, round2, stockQuantity, toCents } from "../src/lib/imports/landedCost.ts";
import { cbarDateParam, cbarUrl, parseCbarXml } from "../src/lib/imports/cbar.ts";
import { DEFAULT_IMPORTS_CONFIG, methodsFor, parseImportsConfig } from "../src/lib/imports/config.ts";
import { draftIssues, emptyShipment, landedCostOf, newCost, newLine, parseShipmentDraft, suggestedVat } from "../src/modules/imports/lib/shipment.ts";
import { shipmentFromRows, shipmentListRows } from "../src/modules/imports/lib/rows.ts";
import { importKpis, importsDefinition, shipmentToRecord } from "../src/modules/imports/views/imports.ts";
import { isNewImportsEnabled } from "../src/lib/features/newImports.ts";
import { extraItemsFor, SHELL_EXTRA_ITEMS } from "../src/lib/shell/shell.ts";
import { CHATTER_MODELS, recordHref } from "../src/views/chatter/logic.ts";
import { MODULES } from "../src/modules/registry.ts";
import { GRANULAR_PERMISSION_MODULES } from "../src/lib/auth/permissionMatrix.ts";
import { azMessages } from "../src/i18n/messages/az.ts";
import { enMessages } from "../src/i18n/messages/en.ts";
import { ruMessages } from "../src/i18n/messages/ru.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const MIGRATION = "supabase/migrations/20261030100000_imports_core.sql";

const cost = (id, costType, amount, splitMethod, extra = {}) => ({ id, costType, amount, rateToAzn: 1, isCapitalized: true, splitMethod, ...extra });

// ── Worked examples from the plan ────────────────────────────────────────────

test("plan example: 100 sheets × 25 USD at 1.70 → 5,506.50 AZN, 13.77 per metre, customs VAT 931.77", () => {
  const r = calculateLandedCost({
    invoiceRate: 1.7,
    lines: [{ id: "ply", qtyPurchase: 100, qtyStock: stockQuantity(100, 4), unitPriceFc: 25, dutyRatePct: 5 }],
    costs: [
      cost("freight", "freight_international", 400, "by_value", { rateToAzn: 1.7 }),
      cost("duty", "customs_duty", 0, "per_line_duty"),
      cost("fee", "customs_fee", 30, "by_value"),
      cost("local", "freight_local", 200, "by_value", { vatAmountAzn: 36 }),
      cost("labour", "labour", 100, "by_quantity"),
    ],
  });
  assert.equal(r.totals.goodsAzn, 4250);
  assert.equal(r.totals.customsValueAzn, 4930);
  assert.equal(r.totals.dutyAzn, 246.5);
  assert.equal(r.totals.landedAzn, 5506.5);
  assert.equal(r.lines[0].landedAzn, 5506.5);
  assert.equal(round2(r.lines[0].unitCostStock), 13.77);
  assert.equal(round2(r.lines[0].unitCostPurchase), 55.07);
  assert.equal(r.totals.customsVatSuggestionAzn, 931.77);
  // The local freight VAT is recoverable, not part of the cost.
  assert.equal(r.totals.recoverableVatAzn, 36);
  assert.equal(r.costs.find((c) => c.id === "duty").amountAzn, 246.5);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.errors, []);
});

const MOCKUP = {
  invoiceRate: 1.7,
  lines: [
    { id: "ply", qtyPurchase: 100, qtyStock: stockQuantity(100, 4), unitPriceFc: 25, weightKg: 100 * 30, dutyRatePct: 5 },
    { id: "mdf", qtyPurchase: 50, qtyStock: stockQuantity(50, 4), unitPriceFc: 18, weightKg: 50 * 35, dutyRatePct: 10 },
    { id: "edge", qtyPurchase: 20, qtyStock: 20 * 200, unitPriceFc: 40, weightKg: 20 * 5, dutyRatePct: 5 },
  ],
  costs: [
    cost("freight", "freight_international", 600, "by_weight", { rateToAzn: 1.7 }),
    cost("duty", "customs_duty", 0, "per_line_duty"),
    cost("fee", "customs_fee", 30, "by_value"),
    cost("local", "freight_local", 300, "by_weight", { vatAmountAzn: 54 }),
    cost("labour", "labour", 150, "by_quantity"),
  ],
};

test("mockup case: three products, each cost split by its own method", () => {
  const r = calculateLandedCost(MOCKUP);
  assert.deepEqual(r.lines.map((l) => l.landedAzn), [5416.63, 2246.64, 1479.63]);
  assert.equal(r.totals.landedAzn, 9142.9);
  assert.deepEqual(r.lines.map((l) => round2(l.unitCostStock)), [13.54, 11.23, 0.37]);
  assert.deepEqual(r.lines.map((l) => l.dutyAzn), [244.05, 189.8, 69.05]);
  assert.equal(r.totals.customsVatSuggestionAzn, 1559.32);
  // Every cost adds up exactly over the lines, and is not one flat percentage of the file.
  for (const c of r.costs) {
    const sum = Object.values(c.allocations).reduce((s, v) => s + toCents(v), 0);
    assert.equal(sum, toCents(c.amountAzn), c.id);
  }
  const share = (costId) => r.lines.map((l) => l.allocations[costId] / r.costs.find((c) => c.id === costId).amountAzn);
  assert.notDeepEqual(share("freight").map(round2), share("fee").map(round2), "weight and value give different shares");
  assert.deepEqual(r.lines.map((l) => l.allocations.labour), [88.23, 44.12, 17.65], "by piece count, remainder to the largest line");
  // The line totals add up to the file total.
  assert.equal(r.lines.reduce((s, l) => s + toCents(l.landedAzn), 0), toCents(r.totals.landedAzn));
});

// ── Rules ───────────────────────────────────────────────────────────────────

test("cents: nearest cent, the remainder to the largest line, sums exact", () => {
  assert.deepEqual(allocateCents(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(allocateCents(1000, [3, 1]), [750, 250]);
  assert.equal(allocateCents(500, [0, 0]), null);
  assert.equal(toCents(1.005), 101);
  assert.equal(round2(2.675), 2.68);
  for (const weights of [[3, 7, 11], [1, 2, 3, 4, 5, 6, 7], [0.1, 0.2, 0.3]]) {
    const shares = allocateCents(123457, weights);
    assert.equal(shares.reduce((s, c) => s + c, 0), 123457);
  }
});

test("VAT is never capitalized: a customs VAT line is recoverable only", () => {
  const r = calculateLandedCost({ ...MOCKUP, costs: [...MOCKUP.costs, cost("cvat", "customs_vat", 1559.32, "by_value")] });
  assert.equal(r.totals.landedAzn, 9142.9, "unchanged by the customs VAT");
  assert.equal(r.totals.recoverableVatAzn, 54 + 1559.32);
  assert.equal(r.costs.find((c) => c.id === "cvat").capitalized, false);
  assert.deepEqual(r.costs.find((c) => c.id === "cvat").allocations, {});
});

test("a cost not capitalized is not split; insurance joins the customs value", () => {
  const base = { invoiceRate: 1, lines: [{ id: "a", qtyPurchase: 10, qtyStock: 10, unitPriceFc: 100, dutyRatePct: 10 }] };
  const r = calculateLandedCost({ ...base, costs: [cost("ins", "insurance", 50, "by_value"), cost("duty", "customs_duty", 0, "per_line_duty"), cost("x", "other", 70, "by_value", { isCapitalized: false })] });
  assert.equal(r.totals.customsValueAzn, 1050);
  assert.equal(r.totals.dutyAzn, 105);
  assert.equal(r.totals.landedAzn, 1000 + 50 + 105);
  // Customs value without insurance when the setting says so.
  const without = calculateLandedCost({ ...base, costs: [cost("ins", "insurance", 50, "by_value"), cost("duty", "customs_duty", 0, "per_line_duty")], settings: { customsValueCostTypes: ["freight_international"] } });
  assert.equal(without.totals.customsValueAzn, 1000);
  assert.equal(without.totals.dutyAzn, 100);
});

test("by weight / volume fall back to by value with a warning when data is missing", () => {
  const lines = [
    { id: "a", qtyPurchase: 1, qtyStock: 1, unitPriceFc: 300, weightKg: 10 },
    { id: "b", qtyPurchase: 1, qtyStock: 1, unitPriceFc: 100, weightKg: null },
  ];
  const r = calculateLandedCost({ invoiceRate: 1, lines, costs: [cost("f", "freight_local", 100, "by_weight"), cost("v", "storage", 40, "by_volume")] });
  assert.deepEqual(r.warnings.map((w) => [w.code, w.costId]), [["missing_weight", "f"], ["missing_volume", "v"]]);
  assert.equal(r.costs[0].method, "by_value");
  assert.deepEqual(r.lines.map((l) => l.allocations.f), [75, 25]);
});

test("chargeable weight = max(weight, volume × factor), factor from settings", () => {
  const lines = [
    { id: "heavy", qtyPurchase: 1, qtyStock: 1, unitPriceFc: 1, weightKg: 500, volumeM3: 1 },
    { id: "bulky", qtyPurchase: 1, qtyStock: 1, unitPriceFc: 1, weightKg: 100, volumeM3: 3 },
  ];
  const r = calculateLandedCost({ invoiceRate: 1, lines, costs: [cost("f", "freight_international", 1499, "chargeable_weight")] });
  // 500 vs 999 kg chargeable.
  assert.deepEqual(r.lines.map((l) => l.allocations.f), [500, 999]);
  const r2 = calculateLandedCost({ invoiceRate: 1, lines, costs: [cost("f", "freight_international", 800, "chargeable_weight")], settings: { chargeableFactor: 100 } });
  assert.deepEqual(r2.lines.map((l) => l.allocations.f), [500, 300]);
});

test("manual split must add up to the cost; equal splits the same per line", () => {
  const lines = [
    { id: "a", qtyPurchase: 1, qtyStock: 1, unitPriceFc: 1 },
    { id: "b", qtyPurchase: 1, qtyStock: 1, unitPriceFc: 1 },
  ];
  const good = calculateLandedCost({ invoiceRate: 1, lines, costs: [cost("m", "other", 100, "manual", { manual: { a: 70, b: 30 } })] });
  assert.deepEqual(good.errors, []);
  assert.deepEqual(good.lines.map((l) => l.allocations.m), [70, 30]);
  const bad = calculateLandedCost({ invoiceRate: 1, lines, costs: [cost("m", "other", 100, "manual", { manual: { a: 70, b: 20 } })] });
  assert.deepEqual(bad.errors, [{ code: "manual_mismatch", costId: "m", amount: 10 }]);
  const eq = calculateLandedCost({ invoiceRate: 1, lines, costs: [cost("e", "labour", 50, "equal")] });
  assert.deepEqual(eq.lines.map((l) => l.allocations.e), [25, 25]);
});

test("per-line duty only for customs duty; costs in another currency use their own rate", () => {
  const lines = [{ id: "a", qtyPurchase: 2, qtyStock: 2, unitPriceFc: 50 }];
  const r = calculateLandedCost({ invoiceRate: 2, lines, costs: [cost("x", "broker", 10, "per_line_duty", { rateToAzn: 1.9 })] });
  assert.deepEqual(r.warnings.map((w) => w.code), ["method_not_for_type"]);
  assert.equal(r.costs[0].amountAzn, 19);
  assert.equal(r.totals.landedAzn, 200 + 19);
});

test("suggested sale price from a margin on the sale price", () => {
  const r = calculateLandedCost({ invoiceRate: 1, lines: [{ id: "a", qtyPurchase: 1, qtyStock: 4, unitPriceFc: 80 }], costs: [], marginPct: 20 });
  assert.equal(r.lines[0].suggestedPricePurchase, 100);
  assert.equal(r.lines[0].suggestedPriceStock, 25);
  assert.equal(calculateLandedCost({ invoiceRate: 1, lines: [{ id: "a", qtyPurchase: 1, qtyStock: 1, unitPriceFc: 1 }], costs: [] }).lines[0].suggestedPriceStock, null);
});

test("stock quantity: sheets × sheet length for sheet products", () => {
  assert.equal(stockQuantity(100, 4), 400);
  assert.equal(stockQuantity(3, 2.44), 7.32);
  assert.equal(stockQuantity(20, null), 20);
});

// ── CBAR ────────────────────────────────────────────────────────────────────

test("CBAR bulletin: per-unit rates (RUB is quoted per 100), the bulletin's own date", () => {
  const b = parseCbarXml(read("tests/fixtures/cbar-29.10.2026.xml"));
  assert.equal(b.date, "2026-10-29");
  assert.equal(b.rates.USD, 1.7);
  assert.equal(b.rates.EUR, 1.8945);
  assert.equal(b.rates.RUB, 0.021118);
  assert.equal(b.rates.TRY, 0.0341);
  assert.equal(b.rates.CNY, 0.2552);
  assert.equal(parseCbarXml("<html>Service unavailable</html>"), null, "an error page is not a bulletin, never a rate of 1");
  assert.equal(parseCbarXml(""), null);
  assert.equal(cbarDateParam("2026-10-29"), "29.10.2026");
  assert.equal(cbarDateParam("2026-02-30"), null);
  assert.equal(cbarUrl("2026-10-29"), "https://www.cbar.az/currencies/29.10.2026.xml");
});

test("the CBAR action reports failures and never falls back to 1", () => {
  const src = read("src/modules/imports/actions/imports.ts");
  const action = src.slice(src.indexOf("export async function cbarRateAction"));
  assert.match(action, /imports\.errors\.cbarDown/);
  assert.match(action, /imports\.errors\.cbarNoRate/);
  assert.match(action, /AbortSignal\.timeout/);
  assert.doesNotMatch(action.replace(/currency === "AZN"[^\n]*\n/, ""), /rate: 1\b/);
});

// ── Settings and drafts ─────────────────────────────────────────────────────

test("settings: defaults, invalid values ignored, customs VAT never capitalized", () => {
  const parsed = parseImportsConfig({
    customsVatRatePct: 500,
    chargeableFactor: "250",
    customsValueCostTypes: ["insurance", "customs_vat", "nonsense"],
    costTypes: { customs_vat: { defaultCapitalized: true }, labour: { defaultMethod: "per_line_duty", name: "  Hamballar " }, freight_local: { defaultVatRatePct: 18 } },
  });
  assert.equal(parsed.customsVatRatePct, 18);
  assert.equal(parsed.chargeableFactor, 250);
  assert.deepEqual(parsed.customsValueCostTypes, ["insurance"]);
  assert.equal(parsed.costTypes.customs_vat.defaultCapitalized, false);
  assert.equal(parsed.costTypes.labour.defaultMethod, DEFAULT_IMPORTS_CONFIG.costTypes.labour.defaultMethod);
  assert.equal(parsed.costTypes.labour.name, "Hamballar");
  assert.deepEqual(parseImportsConfig(null), DEFAULT_IMPORTS_CONFIG);
  assert.ok(methodsFor("customs_duty").includes("per_line_duty"));
  assert.ok(!methodsFor("labour").includes("per_line_duty"));
});

const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const product = { id: UUID(1), code: "PLY-18", name: "Plywood 18", unit: "Vərəq", sheetLengthM: 4 };

test("a draft: new lines in metres, costs with the type's defaults, checks before saving", () => {
  const d = emptyShipment();
  assert.deepEqual(draftIssues(d, DEFAULT_IMPORTS_CONFIG).sort(), ["supplier_required"]);
  const line = { ...newLine(product, 100), unitPriceFc: 25, dutyRatePct: 5 };
  assert.equal(line.qtyStock, 400);
  const local = { ...newCost("freight_local", DEFAULT_IMPORTS_CONFIG), amount: 200 };
  assert.equal(local.splitMethod, "by_weight");
  assert.equal(suggestedVat(local, DEFAULT_IMPORTS_CONFIG), 36);
  assert.equal(newCost("customs_vat", DEFAULT_IMPORTS_CONFIG).isCapitalized, false);
  const draft = { ...d, supplierId: UUID(9), invoiceRate: 1.7, lines: [line], costs: [newCost("customs_duty", DEFAULT_IMPORTS_CONFIG), local] };
  assert.deepEqual(draftIssues(draft, DEFAULT_IMPORTS_CONFIG), []);
  // by_weight without weights: split by value, saved anyway (warning, not an error).
  assert.deepEqual(landedCostOf(draft, DEFAULT_IMPORTS_CONFIG).warnings.map((w) => w.code), ["missing_weight"]);
  assert.equal(landedCostOf(draft, DEFAULT_IMPORTS_CONFIG).totals.landedAzn, 4250 + 212.5 + 200);
  const paid = { ...draft, costs: [{ ...local, paidNow: true }] };
  assert.deepEqual(draftIssues(paid, DEFAULT_IMPORTS_CONFIG), ["cost_paid_account"]);
  assert.deepEqual(draftIssues({ ...draft, status: "confirmed" }, DEFAULT_IMPORTS_CONFIG), ["not_draft"]);
});

test("untrusted input is normalised; customs VAT stays out of the cost", () => {
  const d = parseShipmentDraft({
    id: "not-a-uuid",
    supplierId: UUID(2),
    currencyCode: "GBP",
    invoiceRate: "1.7",
    incoterm: "XYZ",
    lines: [{ key: "k1", productId: UUID(1), qtyPurchase: "3", qtyStock: 12, unitPriceFc: 10, dutyRatePct: 5 }],
    costs: [{ key: "c1", costType: "customs_vat", amount: 10, isCapitalized: true, splitMethod: "by_value" }, { costType: "hack" }],
  });
  assert.equal(d.id, null);
  assert.equal(d.currencyCode, "USD");
  assert.equal(d.invoiceRate, 1.7);
  assert.equal(d.incoterm, null);
  assert.equal(d.lines[0].qtyPurchase, 3);
  assert.equal(d.costs[0].isCapitalized, false);
  assert.equal(d.costs[1].costType, "other");
});

test("stored rows → draft and list; amounts hidden without financial figures", () => {
  const header = { id: UUID(10), number: "IMP-2026-0001", status: "draft", supplier_id: UUID(2), currency_code: "USD", invoice_rate: "1.7", created_by: UUID(5), created_at: "2026-10-30T08:00:00Z" };
  const lines = [{ id: UUID(11), shipment_id: UUID(10), position: 0, product_id: UUID(1), qty_purchase_unit: "100", qty_stock_unit: "400", unit_price_fc: "25", duty_rate_pct: "5" }];
  const costs = [{ id: UUID(12), shipment_id: UUID(10), position: 0, cost_type: "other", amount: "100", rate_to_azn: "1", vat_amount_azn: "0", is_capitalized: true, split_method: "manual" }];
  const allocations = [{ cost_line_id: UUID(12), shipment_line_id: UUID(11), amount_azn: "100" }];
  const draft = shipmentFromRows(header, lines, costs, allocations, true);
  assert.equal(draft.lines[0].key, UUID(11));
  assert.deepEqual(draft.costs[0].manual, { [UUID(11)]: 100 });
  assert.equal(shipmentFromRows(header, lines, costs, allocations, false).lines[0].unitPriceFc, 0);

  const names = new Map([[UUID(5), "Aysel"]]);
  const suppliers = [{ id: UUID(2), full_name: "Kronospan" }];
  const [row] = shipmentListRows({ shipments: [header], lines, costs, allocations, suppliers, names, financials: true });
  assert.deepEqual([row.goods_fc, row.goods_azn, row.costs_azn, row.landed_azn, row.supplier_name, row.created_by_name], [2500, 4250, 100, 4350, "Kronospan", "Aysel"]);
  const [hidden] = shipmentListRows({ shipments: [header], lines, costs, allocations, suppliers, names, financials: false });
  assert.deepEqual([hidden.goods_azn, hidden.landed_azn, hidden.vat_azn], [null, null, null]);
  const record = shipmentToRecord(row);
  assert.equal(record.landed_azn, 4350);
  const fmt = { t: (k) => k, locale: "en" };
  assert.deepEqual(importKpis([shipmentToRecord(hidden)], fmt).map((k) => k.key), ["open", "drafts"], "no money cards without amounts");
});

test("view definition: list columns exist, statuses translated", () => {
  const def = importsDefinition({ fetchAll: async () => [] });
  const fields = new Set(def.fields.map((f) => f.name));
  for (const c of [...def.list.columns, ...def.list.sums, ...def.list.optional]) assert.ok(fields.has(c), c);
  assert.equal(def.model.readPermission, "can_view_imports");
});

// ── Wiring ──────────────────────────────────────────────────────────────────

test("NEW_IMPORTS is off by default; the launcher tiles need it", () => {
  assert.equal(isNewImportsEnabled({}), false);
  assert.equal(isNewImportsEnabled({ NEW_IMPORTS: "TRUE " }), true);
  const paths = (newImports) => extraItemsFor(SHELL_EXTRA_ITEMS, { newCrm: false, newImports }).map((e) => e.path);
  assert.ok(!paths(false).includes("/imports"));
  assert.ok(paths(true).includes("/imports") && paths(true).includes("/settings/imports"));
  for (const page of ["src/app/imports/page.tsx", "src/app/imports/[id]/page.tsx", "src/app/settings/imports/page.tsx"]) {
    assert.match(read(page), /isNewImportsEnabled\(\)/, page);
    assert.match(read(page), /notFound\(\)/, page);
  }
  assert.match(read("src/modules/imports/actions/imports.ts"), /if \(!isNewImportsEnabled\(\)\) throw/);
});

test("module, permissions and chatter are registered", () => {
  const m = MODULES.find((x) => x.id === "imports");
  assert.deepEqual(m.permissions, ["can_view_imports", "can_manage_imports", "can_approve_imports"]);
  const group = GRANULAR_PERMISSION_MODULES.find((g) => g.id === "imports");
  assert.deepEqual(group.permissions.map((p) => `${group.id}.${p.key}`), ["imports.view", "imports.manage", "imports.approve"]);
  assert.ok(CHATTER_MODELS.includes("import_shipments"));
  assert.equal(recordHref("import_shipments", UUID(1)), `/imports/${UUID(1)}`);
  assert.match(read("control-panel/supabase/migrations/20261030100000_imports_module.sql"), /\('imports', 'Imports', '\{core,purchases\}', false\)/);
});

test("migration: tables, RLS on every one, numbering, chatter, atomic save", () => {
  const sql = read(MIGRATION);
  assert.equal(readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter((f) => f.startsWith("20261030100000")).length, 1);
  for (const t of ["currencies", "exchange_rates", "import_shipments", "import_shipment_lines", "import_cost_lines", "import_cost_allocations"]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${t} \\(`), t);
  }
  for (const t of ["currencies", "exchange_rates", "import_shipments", "import_shipment_lines", "import_cost_lines", "import_cost_allocations"]) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`), t);
  }
  for (const code of ["AZN", "USD", "EUR", "TRY", "CNY", "RUB"]) assert.match(sql, new RegExp(`\\('${code}', `));
  assert.match(sql, /unique \(currency_code, rate_date, source\)/);
  assert.match(sql, /'IMP-' \|\| v_year::text \|\| '-' \|\| lpad\(v_no::text, 4, '0'\)/);
  assert.match(sql, /'import_shipments', 'inventory_counts'/);
  assert.match(sql, /check \(cost_type <> 'customs_vat' or not is_capitalized\)/);
  assert.match(sql, /grant execute on function public\.import_shipment_save_draft\([^)]*\) to service_role;/);
  assert.doesNotMatch(sql, /post_journal_entry|create_inventory_batch|stock_movements/, "IMP-1 posts nothing");
  assert.match(read(".github/workflows/db-baseline.yml"), /supabase\/tests\/imports_core\.sql/);
});

test("every imports text exists in az, en and ru", () => {
  const keys = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [`${p}${k}`] : keys(v, `${p}${k}.`)));
  const az = keys(azMessages.imports).sort();
  assert.deepEqual(keys(enMessages.imports).sort(), az);
  assert.deepEqual(keys(ruMessages.imports).sort(), az);
  for (const m of [azMessages, enMessages, ruMessages]) {
    assert.ok(m.newShell.extra_imports && m.newShell.extra_importsSettings);
    assert.ok(m.views.chatter.models.import_shipments);
  }
});
