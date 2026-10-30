import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  dateFormat,
  formatFigure,
  formatGridDate,
  formatGridDateTime,
  formatLongDate,
  formatMoney,
  formatQuantity,
  formatTime,
  toDateValue,
} from "../src/lib/dates/localeDate.ts";
import { formatDate, formatDateTime } from "../src/i18n/translate.ts";
import {
  addDays,
  addMonths,
  isoToDateText,
  isoToDateTimeText,
  isValidDay,
  maskDateText,
  maskDateTimeText,
  monthMatrix,
  parseDateText,
  parseDateTimeText,
} from "../src/design-system/dateInput.ts";
import { filterOptions, isTextTruncated } from "../src/design-system/logic.ts";
import { isUiLabOpen, isUiStandardEnabled } from "../src/lib/features/uiStandard.ts";
import { UI_GUARD_RULES, countViolations, restrictedSyntax, scanSources, uiGuardConfigs } from "../scripts/ui-guard-rules.mjs";
import { compareAllowlist, sourceEntries } from "../scripts/ui-guard-allowlist.mjs";
import { checkContainment, checkFrame, checkOverflow, checkSingleLine, countLines, findIssues } from "../scripts/ui-guard-checks.mjs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const BAKU = { timeZone: "Asia/Baku" };

// ── Formatting module ─────────────────────────────────────────────────────────

test("grid dates are dd.mm.yyyy (HH:mm) in every language: the M10 regression", () => {
  const at = "2026-10-17T09:00:00Z"; // 13:00 in Baku
  assert.equal(formatGridDateTime(at, BAKU), "17.10.2026 13:00");
  assert.equal(formatGridDate(at, BAKU), "17.10.2026");
  assert.equal(formatTime(at, BAKU), "13:00");
  for (const out of [formatGridDateTime(at, BAKU), formatDateTime("az-AZ", at), formatDate("az-AZ", at)]) assert.doesNotMatch(out, /M\d/);
  // dateStyle no longer reaches the browser's az data
  assert.equal(dateFormat("az", { ...BAKU, dateStyle: "medium" }).format(new Date(at)), "17.10.2026");
  assert.equal(dateFormat("az", { ...BAKU, dateStyle: "medium", timeStyle: "short" }).format(new Date(at)), "17.10.2026 13:00");
  assert.equal(dateFormat("az", { ...BAKU, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(at)), "17.10.2026 13:00");
  assert.equal(dateFormat("az", { ...BAKU, dateStyle: "full" }).format(new Date(at)), "17 oktyabr 2026, şənbə");
});

test("a bare yyyy-mm-dd is never shifted by the time zone; empty and invalid values", () => {
  assert.equal(formatGridDate("2026-01-01", { timeZone: "America/Los_Angeles" }), "01.01.2026");
  assert.equal(toDateValue("2026-03-05").getDate(), 5);
  assert.equal(formatGridDate(null), "—");
  assert.equal(formatGridDate("", { empty: "-" }), "-");
  assert.equal(formatGridDateTime("not a date"), "—");
  assert.equal(formatDate("en", null), "-");
  assert.equal(formatDateTime("ru", undefined), "-");
  assert.equal(formatGridDateTime("2026-12-31T20:30:00Z", BAKU), "01.01.2027 00:30");
});

test("month names only in long headings, az from our tables", () => {
  assert.equal(formatLongDate("az", "2026-10-17"), "17 oktyabr 2026");
  assert.equal(formatLongDate("en", "2026-10-17"), "October 17, 2026");
  assert.match(formatLongDate("ru", "2026-10-17"), /^17 октября 2026/);
});

test("money, quantities and figures: fixed separators per language", () => {
  assert.equal(formatFigure(1234567.891, 2, "az"), "1.234.567,89");
  assert.equal(formatFigure(1234567.891, 2, "ru"), "1 234 567,89");
  assert.equal(formatFigure(1234567.891, 2, "en"), "1,234,567.89");
  assert.equal(formatFigure(-0.001, 2, "az"), "0,00");
  assert.equal(formatFigure(1234.5, 2, "az-AZ"), "1.234,50");
  assert.equal(formatMoney(-45.5, "az"), "-45,50 AZN");
  assert.equal(formatMoney(12, "en", { currency: "USD" }), "12.00 USD");
  assert.equal(formatMoney(12, "en", { currency: null, decimals: 0 }), "12");
  assert.equal(formatMoney(null, "az"), "—");
  assert.equal(formatMoney(Number.NaN, "az", { empty: "" }), "");
  assert.equal(formatQuantity(12, "az"), "12");
  assert.equal(formatQuantity(12.5, "az"), "12,5");
  assert.equal(formatQuantity(0.1255, "az"), "0,126");
  assert.equal(formatQuantity(1250.5, "ru"), "1 250,5");
  assert.equal(formatQuantity(undefined, "az"), "—");
});

// ── DateField logic ───────────────────────────────────────────────────────────

test("date mask: dots after day and month, typing on keeps every digit", () => {
  assert.equal(maskDateText("1710"), "17.10");
  assert.equal(maskDateText("17102026"), "17.10.2026");
  assert.equal(maskDateText("17.102"), "17.10.2");
  assert.equal(maskDateText("17."), "17.");
  assert.equal(maskDateText("171020261"), "17.10.2026");
  assert.equal(maskDateText("1.2.2026"), "1.2.2026");
  assert.equal(maskDateText("17/10/2026"), "17.10.2026");
  assert.equal(maskDateText("ab"), "");
});

test("date text ↔ ISO", () => {
  assert.equal(parseDateText("17.10.2026"), "2026-10-17");
  assert.equal(parseDateText("1.2.26"), "2026-02-01");
  assert.equal(parseDateText("31.02.2026"), null);
  assert.equal(parseDateText("29.02.2028"), "2028-02-29");
  assert.equal(parseDateText("17.10"), null);
  assert.equal(isoToDateText("2026-10-17"), "17.10.2026");
  assert.equal(isoToDateText("2026-10-17T13:00:00Z"), "17.10.2026");
  assert.equal(isoToDateText(null), "");
  assert.equal(isValidDay(2026, 13, 1), false);
});

test("date-time text ↔ ISO", () => {
  assert.equal(maskDateTimeText("171020261305"), "17.10.2026 13:05");
  assert.equal(maskDateTimeText("17.10.2026 1305"), "17.10.2026 13:05");
  assert.equal(parseDateTimeText("17.10.2026 13:05"), "2026-10-17T13:05");
  assert.equal(parseDateTimeText("17.10.2026"), "2026-10-17T00:00");
  assert.equal(parseDateTimeText("17.10.2026 24:00"), null);
  assert.equal(isoToDateTimeText("2026-10-17T13:05"), "17.10.2026 13:05");
});

test("calendar: six Monday-first weeks, month and day moves", () => {
  const weeks = monthMatrix(2026, 9); // October 2026 starts on a Thursday
  assert.equal(weeks.length, 6);
  assert.equal(weeks[0][0].iso, "2026-09-28");
  assert.equal(weeks[0][3].iso, "2026-10-01");
  assert.equal(weeks[0][3].inMonth, true);
  assert.equal(weeks[0][0].inMonth, false);
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2026-12-15", 1), "2027-01-15");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

// ── Truncate / Combobox logic ─────────────────────────────────────────────────

test("Truncate shows a tooltip only when the text is really cut", () => {
  assert.equal(isTextTruncated({ scrollWidth: 120, clientWidth: 120 }), false);
  assert.equal(isTextTruncated({ scrollWidth: 121, clientWidth: 120 }), false); // sub-pixel rounding
  assert.equal(isTextTruncated({ scrollWidth: 160, clientWidth: 120 }), true);
  assert.equal(isTextTruncated({ scrollWidth: 10, clientWidth: 10, scrollHeight: 40, clientHeight: 20 }), true);
});

test("Combobox filters on every word of label and hint, Azerbaijani letters included", () => {
  const options = [
    { value: "1", label: "Bakı Logistika MMC", hint: "VÖEN 1700" },
    { value: "2", label: "İstanbul Şüşə", hint: "" },
    { value: "3", label: "ООО «Транссервис»" },
  ];
  assert.deepEqual(filterOptions(options, "").map((o) => o.value), ["1", "2", "3"]);
  assert.deepEqual(filterOptions(options, "bakı 1700").map((o) => o.value), ["1"]);
  assert.deepEqual(filterOptions(options, "şüşə").map((o) => o.value), ["2"]);
  assert.deepEqual(filterOptions(options, "транс").map((o) => o.value), ["3"]);
  assert.deepEqual(filterOptions(options, "nope"), []);
});

// ── Flag ──────────────────────────────────────────────────────────────────────

test("UI_STANDARD is off by default; the open lab needs next dev and UI_LAB_OPEN", () => {
  assert.equal(isUiStandardEnabled({}), false);
  assert.equal(isUiStandardEnabled({ UI_STANDARD: " TRUE " }), true);
  assert.equal(isUiLabOpen({ NODE_ENV: "production", UI_LAB_OPEN: "true" }), false);
  assert.equal(isUiLabOpen({ NODE_ENV: "development" }), false);
  assert.equal(isUiLabOpen({ NODE_ENV: "development", UI_LAB_OPEN: "true" }), true);
  const layout = read("src/app/layout.tsx");
  assert.match(layout, /data-ui-standard=\{uiStandard \? "" : undefined\}/);
  assert.match(read("src/proxy.ts"), /pathname === "\/dev\/ui-lab" && isUiLabOpen\(\)/);
});

test("every --erp-* token is an alias of a --ds-* token under html[data-ui-standard]", () => {
  const legacy = new Set(read("src/design-system/tokens.css").match(/--erp-[a-z0-9-]+(?=:)/g));
  const css = read("src/design-system/ui-standard.css");
  const aliases = new Map([...css.matchAll(/(--erp-[a-z0-9-]+):\s*var\((--ds-[a-z0-9-]+)\)/g)].map((m) => [m[1], m[2]]));
  const missing = [...legacy].filter((t) => !aliases.has(t));
  assert.deepEqual(missing, []);
  // Every --ds-* target exists in theme.css.
  const theme = read("src/design-system/theme.css");
  const unknown = [...new Set(aliases.values())].filter((t) => !theme.includes(`${t}:`));
  assert.deepEqual(unknown, []);
  // The changes apply only under the attribute; the old full-width input stays without it.
  for (const line of css.split("\n").filter((l) => /^\s*[^/*\s@}].*\{\s*$/.test(l))) assert.match(line, /html\[data-ui-standard\]/, line);
  assert.match(read("src/design-system/components.css"), /html:not\(\[data-ui-standard\]\) \[data-ds\] \.ds-input \{\n?\s*width: 100%;/);
  assert.match(theme, /\[data-ds\],\s*\nhtml\[data-ui-standard\] \{/);
});

// ── Lint guard and its allowlist ──────────────────────────────────────────────

test("guard selectors build per-file configs; allowlisted categories are lifted", () => {
  const all = restrictedSyntax();
  assert.equal(all.length, Object.values(UI_GUARD_RULES).reduce((n, r) => n + r.selectors.length, 0));
  assert.ok(restrictedSyntax(["select"]).every((r) => !r.selector.includes('"select"')));
  const configs = uiGuardConfigs({ select: { "src/a.tsx": 2, "src/b.tsx": 1 }, dateInput: { "src/a.tsx": 1 } });
  assert.deepEqual(configs[0].files, ["src/**/*.{ts,tsx}"]);
  const forA = configs.find((c) => c.files.includes("src/a.tsx"));
  const forB = configs.find((c) => c.files.includes("src/b.tsx"));
  assert.notEqual(forA, forB);
  assert.equal(forA.rules["no-restricted-syntax"].length - 1, restrictedSyntax(["dateInput", "select"]).length);
  assert.ok(configs.some((c) => c.files.includes("src/lib/dates/localeDate.ts")), "the formatting module is exempt");
  assert.equal(countViolations('<select a>\n<select\n  b>', "select"), 2);
  assert.equal(countViolations('<input type="date" /><Input type={x ? "datetime-local" : "text"} />', "dateInput"), 2);
  assert.equal(countViolations("d.toLocaleDateString(); new Intl.DateTimeFormat(); n.toLocaleLowerCase()", "localeFormat"), 2);
  assert.deepEqual(scanSources([["src/lib/dates/localeDate.ts", "new Intl.DateTimeFormat()"]]).localeFormat, {});
});

test("the allowlist matches src/ exactly and can only shrink", () => {
  const allowlist = JSON.parse(read("scripts/ui-guard-allowlist.json"));
  const { over, shrink } = compareAllowlist(allowlist, scanSources(sourceEntries()));
  assert.deepEqual(over, [], "new native <select>/<input type=date>/<datalist>/toLocaleString: use Combobox, DateField or src/lib/dates/localeDate.ts");
  assert.deepEqual(shrink, [], "fewer usages than allowed: run `node scripts/ui-guard-allowlist.mjs --write` to lower the allowlist");
  // Ceiling at the time the guard was added (UI-1): these totals may only go down.
  const CEILING = { select: 213, dateInput: 64, datalist: 1, localeFormat: 2 };
  for (const [category, max] of Object.entries(CEILING)) {
    const total = Object.values(allowlist[category] ?? {}).reduce((a, b) => a + b, 0);
    assert.ok(total <= max, `${category}: ${total} > ${max}`);
  }
  assert.deepEqual(Object.keys(allowlist).sort(), Object.keys(UI_GUARD_RULES).sort());
  assert.match(read("eslint.config.mjs"), /\.\.\.uiGuardConfigs\(uiGuardAllowlist\)/);
});

// ── ui-guard pure checks ──────────────────────────────────────────────────────

test("ui-guard checks: lines, overflow, containment, frames", () => {
  assert.equal(countLines([]), 0);
  assert.equal(countLines([10, 10.5, 11]), 1);
  assert.equal(countLines([10, 30]), 2);
  assert.equal(checkSingleLine({ where: "x", text: "a", lineTops: [10, 10] }), null);
  assert.equal(checkSingleLine({ where: "x", text: "Anbara göndərilib", lineTops: [10, 30] }).rule, "single-line");
  assert.equal(checkOverflow({ scrollWidth: 100, clientWidth: 100 }), null);
  assert.equal(checkOverflow({ scrollWidth: 140, clientWidth: 100, truncating: true }), null);
  assert.equal(checkOverflow({ scrollWidth: 140, clientWidth: 100, hasTitle: true }), null);
  assert.equal(checkOverflow({ scrollWidth: 140, clientWidth: 100, where: "w", text: "t" }).rule, "overflow");
  const box = { left: 0, right: 300, bottom: 200 };
  assert.equal(checkContainment({ box, child: { left: 10, right: 300.5, bottom: 150 } }), null);
  assert.equal(checkContainment({ box, child: { left: 10, right: 420, bottom: 150 } }).rule, "containment");
  assert.equal(checkFrame({ scrollWidth: 361, clientWidth: 360 }), null);
  assert.equal(checkFrame({ scrollWidth: 500, clientWidth: 360 }).rule, "frame-overflow");
  assert.equal(findIssues([{ kind: "frame", scrollWidth: 500, clientWidth: 360 }, { kind: "unknown" }]).length, 1);
});

// ── Wiring and texts ──────────────────────────────────────────────────────────

test("the lab, the script and every new text in az, en and ru", async () => {
  const { azMessages } = await import("../src/i18n/messages/az.ts");
  const { enMessages } = await import("../src/i18n/messages/en.ts");
  const { ruMessages } = await import("../src/i18n/messages/ru.ts");
  for (const group of ["date", "combobox", "lab"]) {
    const keys = Object.keys(azMessages.uiStandard[group]).sort();
    assert.deepEqual(Object.keys(enMessages.uiStandard[group]).sort(), keys, group);
    assert.deepEqual(Object.keys(ruMessages.uiStandard[group]).sort(), keys, group);
    for (const m of [azMessages, enMessages, ruMessages]) for (const k of keys) assert.ok(m.uiStandard[group][k].trim(), `${group}.${k}`);
  }
  const page = read("src/app/dev/ui-lab/page.tsx");
  assert.match(page, /isNewUiEnabled\(\)/);
  assert.match(page, /isAdminRole/);
  const lab = read("src/app/dev/ui-lab/UiLab.tsx");
  // Every uiStandard key the lab and the label helpers use exists (no raw keys on screen).
  const used = [...lab.matchAll(/l\("([a-zA-Z]+)"\)/g)].map((m) => m[1]);
  for (const k of new Set(used)) assert.ok(azMessages.uiStandard.lab[k], `uiStandard.lab.${k}`);
  for (const w of ["280", "360", "768", "1280"]) assert.ok(lab.includes(w), w);
  assert.match(lab, /Anbara göndərilib/);
  assert.match(read("package.json"), /"ui:guard": "node scripts\/ui-guard\.mjs"/);
  assert.match(read("docs/ui-standard.md"), /never native select/i);
  // FormView switches to the new controls only with the flag.
  const form = read("src/views/components/FormView.tsx");
  assert.match(form, /standard && field\.type === "date"/);
  assert.match(form, /standard && \(field\.type === "selection" \|\| field\.type === "many2one"\)/);
});
