// GUARD-3: the Accounting Guard section: shaping of findings, the score, the URL state and filters,
// rule thresholds, runs and reports, the Markdown reader, the export columns, the gates around the
// actions, where the section is wired in (menu, lists, document views, bell, widget) and the texts
// in az / en / ru. The database side is checked by supabase/tests/accounting_guard_ui.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_GUARD_QUERY,
  GUARD_CATEGORIES,
  GUARD_SEVERITIES,
  GUARD_TABS,
  SCORE_WEIGHTS,
  compareRuleCodes,
  countBySeverity,
  dashboardFromJson,
  filterFindings,
  findingDay,
  findingDocHref,
  findingFromRow,
  guardFindingsHref,
  guardQueryString,
  healthScore,
  normalizeReason,
  notificationStateFromJson,
  paramFromText,
  paramToText,
  paramsPatch,
  parseGuardQuery,
  reportFromRow,
  ruleFromRow,
  runFromRow,
  runSeconds,
  scanReportMarkdown,
  scanReportSummary,
  scoreTone,
  sortFindings,
  trendPoints,
} from "../src/lib/guard/findings.ts";
import { findingColumns, findingFilterLines, findingsFileName, findingsPeriod } from "../src/lib/guard/export.ts";
import { inlineParts, markdownBlocks } from "../src/lib/guard/markdown.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";
import { SHELL_EXTRA_ITEMS, extraItemsFor } from "../src/lib/shell/shell.ts";
import { WIDGETS, visibleTo, widgetDef } from "../src/lib/home/registry.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

const row = (over = {}) => ({
  id: U(1),
  rule_code: "A1",
  severity: "critical",
  status: "open",
  entity_type: "journal_entry",
  entity_id: U(100),
  doc_no: "JE-1",
  doc_date: "2026-11-01",
  partner_id: null,
  amount: "12.50",
  details: { debit: 10, credit: 9 },
  note: null,
  first_seen_at: "2026-11-02T08:00:00Z",
  last_seen_at: "2026-11-03T08:00:00Z",
  resolved_at: null,
  guard_rules: { category: "ledger" },
  ...over,
});
const finding = (over = {}, extra = {}) => findingFromRow(row(over), extra);

test("a finding row becomes a finding; rows of an unknown shape are dropped", () => {
  const f = finding({}, { partnerName: "Acme", createdBy: U(7), createdByName: "Aysel" });
  assert.equal(f.rule, "A1");
  assert.equal(f.category, "ledger");
  assert.equal(f.amount, 12.5);
  assert.equal(f.partnerName, "Acme");
  assert.equal(f.createdByName, "Aysel");
  assert.deepEqual(f.details, { debit: 10, credit: 9 });
  assert.equal(finding({ severity: "urgent" }), null);
  assert.equal(finding({ status: "weird" }), null);
  assert.equal(finding({ guard_rules: null }), null);
  assert.equal(finding({ id: 5 }), null);
  assert.equal(finding({ guard_rules: null, category: "cash" }).category, "cash");
  assert.equal(finding({ amount: null }).amount, null);
  assert.equal(finding({ details: [1, 2] }).details && Object.keys(finding({ details: [1, 2] }).details).length, 0);
});

test("the health score: 100 minus the weighted open findings, never below 0", () => {
  assert.deepEqual({ ...SCORE_WEIGHTS }, { critical: 10, high: 5, medium: 2, low: 1 });
  assert.equal(healthScore({}), 100);
  assert.equal(healthScore({ critical: 1 }), 90);
  assert.equal(healthScore({ critical: 1, high: 2, medium: 3, low: 4 }), 100 - 10 - 10 - 6 - 4);
  assert.equal(healthScore({ critical: 50 }), 0);
  assert.equal(healthScore({ low: -3, medium: 1.9 }), 98, "negative counts are ignored, fractions cut");
  assert.equal(scoreTone(100), "good");
  assert.equal(scoreTone(90), "good");
  assert.equal(scoreTone(89), "attention");
  assert.equal(scoreTone(60), "attention");
  assert.equal(scoreTone(59), "bad");
});

test("the dashboard answer is read with its score, categories, last run, trend and worst findings", () => {
  const d = dashboardFromJson({
    open: { critical: 2, high: 1, medium: 3, low: 1, total: 7 },
    acknowledged: 4,
    by_category: [{ category: "ledger", critical: 2, high: 0, medium: 0, low: 0, total: 2 }, { category: "nope", total: 9 }],
    last_run: { id: U(5), trigger: "manual", started_at: "2026-11-14T10:00:00Z", finished_at: null, status: "running", new_count: 1, open_count: 7, resolved_count: 0 },
    trend: [{ started_at: "a", status: "ok", new_count: 3, open_count: 5 }, { started_at: "b", status: "ok", new_count: 0, open_count: 8 }],
    top: [row({ id: U(1) }), { id: "x" }],
  });
  assert.equal(d.score, 100 - 20 - 5 - 6 - 1);
  assert.equal(d.acknowledged, 4);
  assert.equal(d.byCategory.length, 1);
  assert.equal(d.lastRun.status, "running");
  assert.equal(d.lastRun.finishedAt, null);
  assert.equal(d.trend.length, 2);
  assert.equal(d.top.length, 1);
  const empty = dashboardFromJson(null);
  assert.equal(empty.score, 100);
  assert.equal(empty.lastRun, null);
  assert.deepEqual(empty.top, []);
});

test("the trend line: nothing for one run, the busiest run at the top", () => {
  assert.deepEqual(trendPoints([{ openCount: 3 }]), []);
  assert.deepEqual(trendPoints([{ openCount: 0 }, { openCount: 10 }, { openCount: 5 }]), [{ x: 0, y: 1 }, { x: 0.5, y: 0 }, { x: 1, y: 0.5 }]);
  assert.deepEqual(trendPoints([{ openCount: 0 }, { openCount: 0 }]), [{ x: 0, y: 1 }, { x: 1, y: 1 }]);
});

test("the URL is the state: parse, defaults, bad values, round trip", () => {
  const p = (qs) => parseGuardQuery(new URLSearchParams(qs));
  assert.deepEqual(p(""), DEFAULT_GUARD_QUERY);
  assert.equal(p("tab=nope").tab, "dashboard");
  assert.equal(p(`finding=${U(1)}`).tab, "findings", "a finding link opens the findings tab");
  assert.equal(p("severity=urgent").severity, null);
  assert.equal(p("category=cash").category, "cash");
  assert.equal(p("rule=A10").rule, "A10");
  assert.equal(p("rule=drop table").rule, null);
  assert.equal(p("status=all").status, "all");
  assert.equal(p("status=false_positive").status, "false_positive");
  assert.equal(p("status=weird").status, "active");
  assert.equal(p("from=2026-11-01&to=2026-13-xx").from, "2026-11-01");
  assert.equal(p("from=2026-11-01&to=2026-13-xx").to, null);
  assert.equal(p("partner=abc").partner, null);
  assert.equal(p(`partner=${U(3)}`).partner, U(3));
  assert.equal(p("entity=sale").entity, "sale");
  assert.equal(p("entity=Sale;1").entity, null);
  assert.equal(p(`q=${"x".repeat(300)}`).search.length, 100);
  const state = { ...DEFAULT_GUARD_QUERY, tab: "findings", severity: "high", category: "documents", rule: "B2", status: "resolved", from: "2026-01-01", to: "2026-02-01", partner: U(3), creator: U(4), entity: "purchase", search: "SS-1", finding: U(9) };
  assert.deepEqual(p(guardQueryString(state)), state);
  assert.equal(guardQueryString(DEFAULT_GUARD_QUERY), "");
  assert.equal(guardFindingsHref(), "/finance/guard?tab=findings");
  assert.equal(guardFindingsHref({ entity: "sale" }), "/finance/guard?tab=findings&entity=sale");
  assert.equal(guardFindingsHref({ severity: "critical", status: "open" }), "/finance/guard?tab=findings&severity=critical&status=open");
  for (const tab of GUARD_TABS) assert.equal(p(`tab=${tab}`).tab, tab);
});

test("filters: severity, category, rule, status, dates, partner, creator, document kind, search", () => {
  const list = [
    finding({ id: U(1), severity: "critical", rule_code: "A1", doc_no: "JE-1", doc_date: "2026-11-01" }),
    finding({ id: U(2), severity: "high", rule_code: "B1", guard_rules: { category: "documents" }, entity_type: "sale", doc_no: "SS-0002", doc_date: "2026-10-01", partner_id: U(30) }, { partnerName: "Acme LLC", createdBy: U(40), createdByName: "Aysel" }),
    finding({ id: U(3), severity: "medium", rule_code: "B2", guard_rules: { category: "documents" }, entity_type: "purchase", doc_no: "PP-0003", doc_date: null, first_seen_at: "2026-09-15T10:00:00Z", status: "acknowledged" }),
    finding({ id: U(4), severity: "low", rule_code: "D3", guard_rules: { category: "partners" }, status: "resolved", doc_no: null }),
    finding({ id: U(5), severity: "low", rule_code: "D3", guard_rules: { category: "partners" }, status: "false_positive" }),
  ];
  const ids = (q) => filterFindings(list, { ...DEFAULT_GUARD_QUERY, ...q }).map((f) => f.id);
  assert.deepEqual(ids({}), [U(1), U(2), U(3)], "active = open + seen, worst first");
  assert.deepEqual(ids({ status: "all" }), [U(1), U(2), U(3), U(4), U(5)]);
  assert.deepEqual(ids({ status: "resolved" }), [U(4)]);
  assert.deepEqual(ids({ status: "open" }), [U(1), U(2)]);
  assert.deepEqual(ids({ severity: "high" }), [U(2)]);
  assert.deepEqual(ids({ category: "documents" }), [U(2), U(3)]);
  assert.deepEqual(ids({ rule: "B2" }), [U(3)]);
  assert.deepEqual(ids({ entity: "sale" }), [U(2)]);
  assert.deepEqual(ids({ partner: U(30) }), [U(2)]);
  assert.deepEqual(ids({ creator: U(40) }), [U(2)]);
  assert.deepEqual(ids({ from: "2026-10-15" }), [U(1)]);
  assert.deepEqual(ids({ to: "2026-09-30" }), [U(3)], "no document date: the day it was first seen");
  assert.deepEqual(ids({ from: "2026-09-01", to: "2026-10-31" }), [U(2), U(3)]);
  assert.deepEqual(ids({ search: "acme" }), [U(2)]);
  assert.deepEqual(ids({ search: "pp-0003" }), [U(3)]);
  assert.deepEqual(ids({ search: "b1" }), [U(2)]);
  assert.deepEqual(ids({ search: "nothing like this" }), []);
  assert.equal(findingDay({ docDate: null, firstSeenAt: "2026-09-15T10:00:00Z" }), "2026-09-15");
  assert.deepEqual(countBySeverity(list), { critical: 1, high: 1, medium: 1, low: 2 });
  // Sorting does not change its input and is stable inside a severity (newest first).
  const copy = [...list];
  sortFindings(list);
  assert.deepEqual(list, copy);
  const same = [finding({ id: U(8), severity: "low", first_seen_at: "2026-01-01T00:00:00Z" }), finding({ id: U(9), severity: "low", first_seen_at: "2026-02-01T00:00:00Z" })];
  assert.deepEqual(sortFindings(same).map((f) => f.id), [U(9), U(8)]);
});

test("where a finding's document opens", () => {
  assert.equal(findingDocHref("sale", U(1)), `/sales/${U(1)}`);
  assert.equal(findingDocHref("purchase", U(1)), `/purchases?record=${U(1)}`);
  assert.equal(findingDocHref("product", U(1)), `/products?highlight=${U(1)}`);
  assert.equal(findingDocHref("partner", U(1)), `/dashboard/partners/${U(1)}`);
  assert.equal(findingDocHref("account", U(1)), "/cash-bank");
  assert.equal(findingDocHref("journal_entry", U(1)), null);
  assert.equal(findingDocHref("sale", null), null);
  assert.equal(findingDocHref(null, U(1)), null);
});

test("rules: order of codes, thresholds as text, a patch of only what changed", () => {
  assert.deepEqual(["B1", "A10", "A2", "F1", "A1", "E5", "D3"].sort(compareRuleCodes), ["A1", "A2", "A10", "B1", "D3", "E5", "F1"]);
  const rule = ruleFromRow({ code: "A6", category: "ledger", default_severity: "critical", enabled: true, params: { tolerance: 0.01, document_types: ["invoice", "bill"], receivable_code: "1200" }, description_key: "guard.rule.A6" });
  assert.equal(rule.enabled, true);
  assert.equal(ruleFromRow({ code: "A6", category: "nope", default_severity: "critical" }), null);
  assert.equal(paramToText(["a", "b"]), "a, b");
  assert.equal(paramToText(0.01), "0.01");
  assert.equal(paramToText(null), "");
  assert.equal(paramFromText(0.01, "0,5"), 0.5);
  assert.equal(paramFromText(0.01, " 2 "), 2);
  assert.equal(paramFromText(0.01, "-1"), null);
  assert.equal(paramFromText(0.01, "abc"), null);
  assert.equal(paramFromText(0.01, ""), null);
  assert.deepEqual(paramFromText(["x"], "a, b ,c"), ["a", "b", "c"]);
  assert.equal(paramFromText(["x"], "a,,b"), null);
  assert.equal(paramFromText("1200", " 1100 "), "1100");
  assert.equal(paramFromText("1200", " "), null);
  const edited = { tolerance: "0.01", document_types: "invoice, bill, sale_cogs", receivable_code: "1200" };
  assert.deepEqual(paramsPatch(rule, edited), { patch: { document_types: ["invoice", "bill", "sale_cogs"] }, invalid: [] });
  assert.deepEqual(paramsPatch(rule, { tolerance: "-3" }), { patch: {}, invalid: ["tolerance"] });
  assert.deepEqual(paramsPatch(rule, {}), { patch: {}, invalid: [] });
  assert.deepEqual(paramsPatch(rule, { unknown: "1" }), { patch: {}, invalid: [] });
});

test("runs and reports", () => {
  const run = runFromRow({ id: U(1), trigger: "scheduled", scope: ["ledger"], started_at: "2026-11-14T10:00:00Z", finished_at: "2026-11-14T10:00:02.5Z", status: "partial", rules_run: ["A1"], new_count: 2, open_count: 9, resolved_count: 1, error: "A2: boom", rule_errors: { A2: "P0001: boom" } });
  assert.equal(run.status, "partial");
  assert.deepEqual(run.ruleErrors, { A2: "P0001: boom" });
  assert.equal(runSeconds(run), 2.5);
  assert.equal(runSeconds({ startedAt: "2026-11-14T10:00:00Z", finishedAt: null }), null);
  assert.equal(runFromRow({ trigger: "x" }), null);
  const report = reportFromRow({ id: U(2), kind: "scan", title: "T", body: "# T", summary: { total: 1 }, created_by_type: "ai", created_at: "2026-11-14T10:00:00Z", created_by: null });
  assert.equal(report.createdByType, "ai");
  assert.equal(reportFromRow({ id: U(2), kind: "weekly", title: "T" }), null);
  assert.equal(reportFromRow({ id: U(2), kind: "daily", title: "T", created_by_type: "robot" }).createdByType, "user");
  assert.deepEqual(notificationStateFromJson({ new_findings: 3, new_critical: 1, new_reports: 2 }), { newFindings: 3, newCritical: 1, newReports: 2 });
  assert.deepEqual(notificationStateFromJson(null), { newFindings: 0, newCritical: 0, newReports: 0 });
});

test("a saved snapshot: Markdown by severity, the counts and the rows for Excel", () => {
  const list = [finding({ id: U(1) }, { partnerName: "Acme" }), finding({ id: U(2), severity: "low", rule_code: "D3", guard_rules: { category: "partners" }, amount: null, doc_no: null })];
  const labels = { title: "Findings of 14.11.2026", counts: "Counts", severity: (s) => s.toUpperCase(), rule: (c) => `rule ${c}`, none: "none", amount: (v) => `${v} AZN` };
  const md = scanReportMarkdown(list, labels);
  assert.match(md, /^# Findings of 14\.11\.2026\n/);
  assert.match(md, /\*\*Counts:\*\* CRITICAL 1, HIGH 0, MEDIUM 0, LOW 1/);
  assert.match(md, /## CRITICAL \(1\)\n\n- \*\*A1\*\* · rule A1 · JE-1 · Acme · 12\.5 AZN/);
  assert.match(md, /## LOW \(1\)\n\n- \*\*D3\*\* · rule D3/);
  assert.doesNotMatch(md, /## HIGH/);
  assert.match(scanReportMarkdown([], labels), /\nnone\n$/);
  const summary = scanReportSummary(list);
  assert.equal(summary.total, 2);
  assert.deepEqual(summary.counts, { critical: 1, high: 0, medium: 0, low: 1 });
  assert.equal(summary.findings[0].partner, "Acme");
  assert.equal(summary.findings[0].first_seen, "2026-11-02");
  // The Markdown the snapshot writes is readable by the report screen.
  const blocks = markdownBlocks(md);
  assert.equal(blocks[0].type, "heading");
  assert.ok(blocks.some((b) => b.type === "list" && b.items.length === 1));
});

test("the Markdown reader builds blocks, never HTML", () => {
  const blocks = markdownBlocks("# Title\n\nFirst line\nsecond line\n\n- one\n- **two**\n\n1. a\n2) b\n\n### Small\r\n<script>alert(1)</script>");
  assert.deepEqual(blocks.map((b) => b.type), ["heading", "paragraph", "list", "list", "heading", "paragraph"]);
  assert.equal(blocks[1].text, "First line second line");
  assert.deepEqual(blocks[2], { type: "list", ordered: false, items: ["one", "**two**"] });
  assert.deepEqual(blocks[3], { type: "list", ordered: true, items: ["a", "b"] });
  assert.equal(blocks[4].level, 3);
  assert.equal(blocks[5].text, "<script>alert(1)</script>", "kept as text; React escapes it");
  assert.deepEqual(inlineParts("a **b** c **d"), [{ text: "a ", bold: false }, { text: "b", bold: true }, { text: " c **d", bold: false }]);
  assert.deepEqual(markdownBlocks(""), []);
});

test("export: the same columns for Excel and paper, the filters named, a file name, a period", () => {
  const t = (key, p) => (p ? `${key}:${JSON.stringify(p)}` : key);
  const f = finding({ id: U(1) }, { partnerName: "Acme", createdByName: "Aysel" });
  const cols = findingColumns(t);
  assert.deepEqual(cols.map((c) => c.kind), ["text", "text", "text", "text", "date", "text", "money", "text", "date", "text"]);
  const values = cols.map((c) => c.value(f));
  assert.equal(values[0], "guard.severity.critical");
  assert.equal(values[1], "A1 · guard.rule.A1");
  assert.equal(values[3], "JE-1");
  assert.equal(values[6], 12.5);
  assert.equal(values[8], "2026-11-02");
  const lines = findingFilterLines({ ...DEFAULT_GUARD_QUERY, severity: "high", partner: U(3), from: "2026-11-01", search: "x" }, t, { partner: "Acme" });
  assert.deepEqual(lines.map(([k]) => k), ["guard.ui.colStatus", "guard.ui.colSeverity", "guard.ui.from", "guard.ui.colPartner", "guard.ui.search"]);
  assert.equal(lines[3][1], "Acme");
  assert.equal(lines[2][1], "01.11.2026");
  assert.equal(findingFilterLines({ ...DEFAULT_GUARD_QUERY, partner: U(3) }, t)[1][1], U(3), "an unknown name falls back to the id");
  assert.equal(findingsFileName("2026-11-14"), "accounting-guard-findings-2026-11-14.xlsx");
  assert.deepEqual(findingsPeriod([f, finding({ id: U(2), doc_date: "2026-10-01" })]), { from: "2026-10-01", to: "2026-11-01" });
  assert.equal(findingsPeriod([]), null);
  assert.equal(normalizeReason("  ok  then "), "ok then");
  assert.equal(normalizeReason("no"), null);
});

test("the section's actions need an admin and the flag, and write only the guard's own data", () => {
  const src = read("src/lib/actions/accountingGuardSection.ts");
  assert.match(src, /^"use server";/);
  assert.doesNotMatch(src, /^export (const|let|var|class|function) /m, "a use-server file exports only async functions");
  const exported = [...src.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
  assert.ok(exported.length >= 14, exported.join(", "));
  for (const name of exported) {
    const body = src.slice(src.indexOf(`export async function ${name}`));
    const next = body.indexOf("\nexport ", 10);
    assert.match(next > 0 ? body.slice(0, next) : body, /requireGuardAdmin\(\)/, name);
  }
  // Only the guard's functions and tables; never a business table's write.
  assert.deepEqual([...new Set([...src.matchAll(/\.rpc\("(\w+)"/g)].map((m) => m[1]))].sort(), [
    "guard_bulk_set_status", "guard_create_report", "guard_dashboard", "guard_mark_seen", "guard_notification_state", "guard_scan", "guard_schedule_state", "guard_set_finding_status", "guard_set_schedule", "guard_update_rule",
  ]);
  assert.doesNotMatch(src, /\.(insert|update|delete|upsert)\(/);
  const tables = [...new Set([...src.matchAll(/\.from\("(\w+)"\)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(tables, ["guard_finding_events", "guard_findings", "guard_reports", "guard_rules", "guard_runs"]);
  // Business tables are only read, in chunks, for the partner's name and the document's creator.
  assert.deepEqual([...src.matchAll(/inChunks\(db, "(\w+)"/g)].map((m) => m[1]).sort(), ["partners", "purchases", "sales"]);
  // The service client only looks up people's names; everything else runs as the admin.
  assert.equal([...src.matchAll(/createSupabaseAdminClient\(\)/g)].length, 2);
  assert.equal([...src.matchAll(/fetchProfileDisplayNames\(\(await createSupabaseAdminClient\(\)\)/g)].length, 2);
  // Validation before the database: ids, statuses, scope items, kinds.
  assert.match(src, /findingIds\.length > 500/);
  assert.match(src, /status === "resolved" \|\| status === "false_positive"\) && !reason/);
  assert.match(src, /SCOPE_ITEM\.test/);
  assert.match(src, /p_kind: "scan"/);
});

test("the page is a 404 without the flag or an admin; the route needs settings; the menu entry follows the flag", () => {
  const page = read("src/app/finance/guard/page.tsx");
  assert.match(page, /if \(!isAccountingGuardEnabled\(\)\) notFound\(\);/);
  assert.match(page, /if \(!isAdminRole\(profile\?\.role\)\) notFound\(\);/);
  assert.match(read("src/modules/accounting/manifest.ts"), /\{ prefix: "\/finance\/guard", permission: "can_manage_settings" \}/);
  const item = SHELL_EXTRA_ITEMS.find((e) => e.path === "/finance/guard");
  assert.equal(item.flag, "accountingGuard");
  const has = (flags) => extraItemsFor(SHELL_EXTRA_ITEMS, { newCrm: false, ...flags }).some((e) => e.path === "/finance/guard");
  assert.equal(has({}), false);
  assert.equal(has({ accountingGuard: false }), false);
  assert.equal(has({ accountingGuard: true }), true);
  assert.match(read("src/components/shell/useShell.ts"), /const accountingGuard = useAccountingGuard\(\);/);
});

test("the section is wired into the lists, the document views, the bell and the home page", () => {
  for (const [file, entity] of [
    ["src/modules/sales/components/SalesPage.tsx", "sale"],
    ["src/modules/sales/components/SalesScreen.tsx", "sale"],
    ["src/modules/purchases/components/PurchasesPage.tsx", "purchase"],
    ["src/modules/purchases/components/PurchasesScreen.tsx", "purchase"],
  ]) {
    assert.match(read(file), new RegExp(`<FindSuspiciousButton entity="${entity}" />`), file);
  }
  assert.match(read("src/modules/sales/components/SaleDetailPage.tsx"), /<DocumentFindingsChip entity="sale"/);
  assert.match(read("src/modules/purchases/components/PurchaseViewModal.tsx"), /<DocumentFindingsChip entity="purchase"/);
  for (const file of ["FindSuspiciousButton", "DocumentFindingsChip"]) assert.match(read(`src/components/guard/${file}.tsx`), /if \(!active\) return null;|enabled: active/, file);
  // What "Find suspicious documents" scans, and where it lands.
  const button = read("src/components/guard/FindSuspiciousButton.tsx");
  assert.match(button, /SUSPICIOUS_SCOPE = \["ledger", "documents", "cash", "partners"\]/);
  assert.match(button, /router\.push\(guardFindingsHref\(\{ entity \}\)\)/);
  // The bell: only for admins with the flag, new serious findings and new reports, each a link.
  const shell = read("src/components/shell/NewShell.tsx");
  assert.match(shell, /enabled: guard,/);
  assert.match(shell, /guard\.ui\.bellNewFindings/);
  assert.match(shell, /guard\.ui\.bellNewReports/);
  // The widget: registered behind the flag, for admins; hidden otherwise.
  const def = widgetDef("accounting_guard");
  assert.equal(def.requires, "accountingGuard");
  assert.equal(def.financial, false);
  const ctx = (guard) => ({ isEnabled: () => true, can: () => true, financials: true, flags: { newCrm: false, accountingGuard: guard } });
  assert.equal(visibleTo(def, ctx(true)), true);
  assert.equal(visibleTo(def, ctx(false)), false);
  assert.equal(visibleTo(def, { ...ctx(true), flags: { newCrm: false } }), false);
  assert.match(read("src/components/home/useHomeLayout.ts"), /flags: \{ newCrm, accountingGuard \}/);
  assert.ok(WIDGETS.some((w) => w.id === "accounting_guard"));
});

function leaves(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) => (typeof v === "string" ? [`${prefix}${k}`] : leaves(v, `${prefix}${k}.`)));
}
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const lookup = (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj);

test("every guard text exists in az, en and ru with the same placeholders", () => {
  const base = leaves(enMessages.guard);
  assert.ok(base.length > 250, `${base.length} texts`);
  assert.deepEqual(leaves(azMessages.guard), base);
  assert.deepEqual(leaves(ruMessages.guard), base);
  for (const key of base) {
    const en = lookup(enMessages.guard, key);
    assert.deepEqual(placeholders(lookup(azMessages.guard, key)), placeholders(en), `az ${key}`);
    assert.deepEqual(placeholders(lookup(ruMessages.guard, key)), placeholders(en), `ru ${key}`);
  }
  assert.ok(azMessages.nav.items.accountingGuard && enMessages.nav.items.accountingGuard && ruMessages.nav.items.accountingGuard);
  for (const m of [azMessages, enMessages, ruMessages]) {
    assert.ok(m.home.widgets.accounting_guard.title && m.home.widgets.accounting_guard.description);
  }
});

test("texts follow the rulebook: one script per language, no ALL CAPS, every severity, category and status named", () => {
  const cyrillic = /[Ѐ-ӿ]/;
  for (const key of leaves(azMessages.guard)) assert.doesNotMatch(lookup(azMessages.guard, key), cyrillic, `az ${key} has Cyrillic letters`);
  for (const key of leaves(ruMessages.guard)) {
    const text = lookup(ruMessages.guard, key).replace(/\{\w+\}/g, "");
    // Only product-neutral codes and units stay Latin in the Russian texts: Excel, PDF, AZN, ids.
    assert.doesNotMatch(text.replace(/Excel|PDF|AZN|UTC|pg_cron|Supabase|Database|Extensions/g, ""), /[A-Za-z]{3,}/, `ru ${key} has Latin words`);
  }
  for (const messages of [azMessages, enMessages, ruMessages]) {
    for (const key of leaves(messages.guard)) {
      const text = lookup(messages.guard, key).replace(/\{\w+\}/g, "");
      assert.doesNotMatch(text.replace(/Excel|PDF|AZN/g, ""), /\b[A-ZƏÖÜŞÇĞİА-Я]{4,}\b/, `${key} is in capitals`);
    }
    assert.deepEqual(Object.keys(messages.guard.severity).sort(), [...GUARD_SEVERITIES].sort());
    assert.deepEqual(Object.keys(messages.guard.category).sort(), [...GUARD_CATEGORIES].sort());
    assert.deepEqual(Object.keys(messages.guard.status).sort(), ["acknowledged", "auto_resolved", "false_positive", "open", "resolved"]);
    for (const tab of GUARD_TABS) assert.ok(messages.guard.ui[`tab_${tab}`], tab);
  }
});

test("every rule the migrations seed has a description in all three languages", () => {
  const codes = new Set();
  for (const file of ["20261120100000_accounting_guard_core.sql", "20261120110000_accounting_guard_products.sql"]) {
    const sql = read(`supabase/migrations/${file}`);
    for (const m of sql.matchAll(/\('([A-Z]\d{1,2})',\s+'(ledger|documents|cash|partners|products|stock)'/g)) codes.add(m[1]);
  }
  assert.equal(codes.size, 34);
  for (const code of codes) {
    for (const messages of [azMessages, enMessages, ruMessages]) assert.ok(messages.guard.rule[code], `rule ${code}`);
    assert.match(read("supabase/migrations/20261120100000_accounting_guard_core.sql") + read("supabase/migrations/20261120110000_accounting_guard_products.sql"), new RegExp(`'guard\\.rule\\.${code}'`), `${code} description key`);
  }
  assert.deepEqual(Object.keys(enMessages.guard.rule).sort(), [...codes].sort());
});

test("the migration is read-only toward business data and admin-only", () => {
  const sql = read("supabase/migrations/20261120120000_accounting_guard_ui.sql");
  assert.doesNotMatch(sql, /CREATE (OR REPLACE )?TRIGGER/i);
  const business = ["journal_entries", "journal_entry_lines", "sales", "sale_items", "purchases", "payments", "transactions", "accounts", "expenses", "partners", "products"];
  for (const t of business) assert.doesNotMatch(sql, new RegExp(`(INSERT INTO|UPDATE|DELETE FROM|TRUNCATE)\\s+public\\.${t}\\b`, "i"), t);
  const writes = [...sql.matchAll(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.(\w+)/gi)].map((m) => m[1]);
  assert.deepEqual([...new Set(writes)].sort(), ["audit_logs", "guard_admin_state", "guard_reports", "guard_rules"]);
  for (const fn of ["guard_dashboard", "guard_update_rule", "guard_bulk_set_status", "guard_create_report", "guard_notification_state", "guard_mark_seen"]) {
    const body = sql.slice(sql.indexOf(`FUNCTION public.${fn}(`));
    assert.match(body.slice(0, body.indexOf("$$;", 20)), /PERFORM public\._guard_authorize\(\);/, fn);
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO authenticated, service_role`), fn);
  }
  assert.doesNotMatch(sql, /CREATE POLICY[^;]*FOR (INSERT|UPDATE|DELETE|ALL)/);
  assert.match(read(".github/workflows/db-baseline.yml"), /supabase\/tests\/accounting_guard_ui\.sql/);
});
