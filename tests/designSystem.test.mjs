// Design system of the new UI (prompt 15): brand colour, theme scope, motion budget, the
// components' logic, CSS scoping (nothing outside [data-ds] may change), the /dev/design gate
// and its texts.   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  brandCssVars,
  contrastRatio,
  DEFAULT_BRAND,
  normalizeHex,
  parseBrandSetting,
  readableOn,
  shade,
} from "../src/design-system/brand.ts";
import { effectiveTheme, resolveDsDensity, resolveDsTheme, scopeAttributes } from "../src/design-system/theme.ts";
import {
  checkFile,
  confirmState,
  countUpValue,
  decimalsOf,
  deltaKind,
  easeOutCubic,
  fileExtension,
  filterPalette,
  formatFigure,
  formatFileSize,
  funnelRows,
  funnelSummary,
  goalProgress,
  heatCell,
  percentChange,
  ringDash,
  scaleStacked,
  searchKey,
  sparklineHeights,
  TOAST_LIMIT,
  toastReducer,
  wrapIndex,
} from "../src/design-system/logic.ts";
import {
  COUNT_UP_DURATION,
  DURATION,
  listItemVariants,
  motionPreset,
  overlayVariants,
  pageVariants,
  panelVariants,
  recordLayoutId,
  reducedVariants,
  toastVariants,
  transitions,
} from "../src/design-system/motion.ts";
import { isNewUiEnabled } from "../src/lib/features/newUi.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// ── Brand ────────────────────────────────────────────────────────────────────

test("brand colours: normalised, readable text chosen by WCAG contrast, hover and tint derived", () => {
  assert.equal(normalizeHex(" #0F766E "), "#0f766e");
  assert.equal(normalizeHex("08f"), "#0088ff");
  assert.equal(normalizeHex("#12345"), null);
  assert.equal(normalizeHex("red"), null);
  assert.equal(readableOn("#ffeb3b"), "#111318", "dark text on yellow");
  assert.equal(readableOn("#1e3a8a"), "#ffffff", "white text on navy");
  assert.ok(contrastRatio("#000000", "#ffffff") > 20.9);
  assert.equal(shade("#808080", 0.5), "#404040");
  assert.equal(shade("#000000", -0.5), "#808080");

  const vars = brandCssVars("#2563EB");
  assert.deepEqual(vars, {
    "--ds-brand": "#2563eb",
    "--ds-brand-hover": shade("#2563eb", 0.1),
    "--ds-brand-fg": "#ffffff",
    "--ds-brand-soft": "rgb(37 99 235 / 0.12)",
    "--ds-heat": "37 99 235",
  });
  assert.ok(contrastRatio(vars["--ds-brand"], vars["--ds-brand-fg"]) >= 4.5, "button text meets AA");
  assert.equal(brandCssVars("not a colour")["--ds-brand"], DEFAULT_BRAND);
  assert.equal(brandCssVars("#050505")["--ds-brand-hover"], shade("#050505", -0.18), "very dark brands lighten on hover");
});

test("brand setting from system_settings.ui_brand is read leniently", () => {
  assert.deepEqual(parseBrandSetting({ primary: "#ABCDEF" }), { primary: "#abcdef" });
  for (const bad of [null, "x", [], {}, { primary: "blue" }]) assert.equal(parseBrandSetting(bad), null);
});

test("scope attributes: unknown theme or density fall back; brand goes into the inline style", () => {
  assert.equal(resolveDsTheme("dark"), "dark");
  assert.equal(resolveDsTheme("sepia"), "system");
  assert.equal(resolveDsDensity("compact"), "compact");
  assert.equal(resolveDsDensity(undefined), "comfortable");
  assert.equal(effectiveTheme("system", true), "dark");
  assert.equal(effectiveTheme("light", true), "light");
  const a = scopeAttributes({ theme: "dark", density: "compact", brand: "#ff0000" });
  assert.equal(a["data-ds"], "");
  assert.equal(a["data-ds-theme"], "dark");
  assert.equal(a["data-ds-density"], "compact");
  assert.equal(a.style["--ds-brand"], "#ff0000");
});

// ── Motion ───────────────────────────────────────────────────────────────────

test("motion stays within 200–300 ms and matches the CSS durations", () => {
  for (const d of Object.values(DURATION)) assert.ok(d >= 0.2 && d <= 0.3, String(d));
  for (const [name, t] of Object.entries(transitions)) {
    if (name === "instant") continue;
    assert.ok(t.duration >= 0.2 && t.duration <= 0.3, `${name}: ${t.duration}`);
  }
  assert.ok(COUNT_UP_DURATION >= 0.2 && COUNT_UP_DURATION <= 0.3);
  const css = read("src/design-system/theme.css");
  assert.match(css, /--ds-duration-fast: 200ms;/);
  assert.match(css, /--ds-duration-base: 240ms;/);
  assert.match(css, /--ds-duration-slow: 300ms;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*--ds-duration-slow: 0ms;/);
});

test("reduced motion: presets keep opacity only and switch instantly", () => {
  for (const variants of [pageVariants, listItemVariants, overlayVariants, panelVariants, toastVariants]) {
    const reduced = reducedVariants(variants);
    for (const [name, v] of Object.entries(reduced)) {
      for (const key of ["x", "y", "scale", "height"]) assert.ok(!(key in v), `${name} still moves ${key}`);
      assert.deepEqual(v.transition, { duration: 0 });
    }
  }
  assert.equal(motionPreset(pageVariants, false), pageVariants);
  assert.notEqual(motionPreset(pageVariants, true), pageVariants);
  assert.equal(recordLayoutId("sales", 42), "record:sales:42:card");
});

// ── Component logic ──────────────────────────────────────────────────────────

const GROUPS = [
  { id: "go", heading: "Go to", commands: [{ id: "sales", label: "Satış", keywords: ["sales"] }, { id: "inv", label: "Anbar qalığı", keywords: ["inventory", "склад"] }] },
  { id: "act", heading: "Actions", commands: [{ id: "new", label: "Yeni hesab-faktura" }] },
  { id: "none", heading: "Empty", commands: [] },
];

test("palette: every word must match label or keywords, accents and İ/ı ignored, empty groups hidden", () => {
  assert.equal(searchKey("İnventar Qalığı ə"), "inventar qaligi e");
  assert.deepEqual(filterPalette(GROUPS, "").map((g) => g.id), ["go", "act"], "no query: all non-empty groups");
  assert.deepEqual(filterPalette(GROUPS, "satis").map((g) => g.commands.map((c) => c.id)), [["sales"]]);
  assert.deepEqual(filterPalette(GROUPS, "СКЛАД").map((g) => g.commands[0].id), ["inv"], "Cyrillic keyword, any case");
  assert.deepEqual(filterPalette(GROUPS, "yeni faktura").map((g) => g.id), ["act"]);
  assert.deepEqual(filterPalette(GROUPS, "nothing"), []);
  assert.deepEqual([wrapIndex(0, -1, 3), wrapIndex(2, 1, 3), wrapIndex(1, 1, 3), wrapIndex(0, 1, 0)], [2, 0, 2, -1]);
});

test("toasts: newest last, same id replaced, at most four, dismiss and clear", () => {
  const t = (id) => ({ id, title: id, variant: "info", duration: 5000 });
  let state = [];
  for (const id of ["a", "b", "c", "d", "e"]) state = toastReducer(state, { type: "add", toast: t(id) });
  assert.equal(TOAST_LIMIT, 4);
  assert.deepEqual(state.map((x) => x.id), ["b", "c", "d", "e"]);
  state = toastReducer(state, { type: "add", toast: { ...t("c"), title: "C!" } });
  assert.deepEqual(state.map((x) => x.title), ["b", "d", "e", "C!"]);
  assert.deepEqual(toastReducer(state, { type: "dismiss", id: "d" }).map((x) => x.id), ["b", "e", "c"]);
  assert.deepEqual(toastReducer(state, { type: "clear" }), []);
});

test("dropzone: size, type (extension, MIME, wildcard) and empty files are checked; sizes are readable", () => {
  const rules = { maxBytes: 1024 * 1024, accept: [".pdf", "image/*"] };
  assert.deepEqual(checkFile({ name: "a.PDF", size: 10, type: "" }, rules), { ok: true });
  assert.deepEqual(checkFile({ name: "photo", size: 10, type: "image/png" }, rules), { ok: true });
  assert.deepEqual(checkFile({ name: "a.exe", size: 10, type: "application/x-msdownload" }, rules), { ok: false, reason: "wrongType" });
  assert.deepEqual(checkFile({ name: "big.pdf", size: 1024 * 1024 + 1, type: "" }, rules), { ok: false, reason: "tooLarge" });
  assert.deepEqual(checkFile({ name: "e.pdf", size: 0, type: "" }, rules), { ok: false, reason: "empty" });
  assert.deepEqual(checkFile({ name: "any.bin", size: 5, type: "" }, { maxBytes: 10, accept: [] }), { ok: true });
  assert.deepEqual([fileExtension("report.final.XLSX"), fileExtension(".env"), fileExtension("noext")], ["xlsx", "", ""]);
  assert.deepEqual([formatFileSize(512), formatFileSize(1536), formatFileSize(15 * 1024 * 1024)], ["512 B", "1.5 KB", "15 MB"]);
});

test("type to confirm: only an exact match enables the action; a wrong letter marks the input", () => {
  assert.equal(confirmState("", "acme"), "empty");
  assert.equal(confirmState("ac", "acme"), "partial");
  assert.equal(confirmState("acx", "acme"), "diverged");
  assert.equal(confirmState("Acme", "acme"), "diverged", "case matters");
  assert.equal(confirmState("acme", "acme"), "match");
  assert.equal(confirmState("acme ", "acme"), "diverged");
});

test("sparklines, deltas and ring gauges", () => {
  assert.deepEqual(sparklineHeights([0, 5, 10]), [8, 50, 100]);
  assert.deepEqual(sparklineHeights([0, 0]), [8, 8]);
  assert.deepEqual([deltaKind(3), deltaKind(-0.1), deltaKind(0), deltaKind(NaN)], ["up", "down", "flat", "flat"]);
  const ring = ringDash(25, 42);
  assert.ok(Math.abs(ring.circumference - 2 * Math.PI * 42) < 1e-9);
  assert.ok(Math.abs(ring.offset - ring.circumference * 0.75) < 1e-9);
  assert.equal(ringDash(140, 42).offset, 0);
  assert.equal(ringDash(-5, 42).percent, 0);
});

test("funnel: widths against the first step, drops between steps, label inside only when wide", () => {
  const rows = funnelRows([
    { label: "Leads", count: 1000 },
    { label: "Quotes", count: 400 },
    { label: "Orders", count: 100 },
  ]);
  assert.deepEqual(
    rows.map((r) => [r.percentOfFirst, r.stepConversion, r.dropped, r.droppedPercent, r.labelInside]),
    [
      [100, 100, 0, 0, true],
      [40, 40, 600, 60, true],
      [10, 25, 300, 75, false],
    ]
  );
  assert.deepEqual(funnelSummary([{ label: "a", count: 1000 }, { label: "b", count: 100 }]), { entered: 1000, completed: 100, conversion: 10 });
  assert.deepEqual(funnelRows([{ label: "a", count: 0 }, { label: "b", count: 0 }]).map((r) => r.percentOfFirst), [0, 0]);
});

test("goals: percent of target, bar capped at 100, behind when under 90 % of the expected pace", () => {
  assert.deepEqual(goalProgress(150, 100, 0.5), { percent: 150, bar: 100, status: "done" });
  assert.equal(goalProgress(45, 100, 0.5).status, "onTrack");
  assert.equal(goalProgress(44, 100, 0.5).status, "behind");
  assert.equal(goalProgress(10, 0, 0.5).percent, 0);
});

test("heatmap cells: alpha follows the percentage, white text once dark, future weeks empty", () => {
  assert.deepEqual(heatCell(null), { alpha: 0, darkText: true, empty: true });
  assert.deepEqual(heatCell(0), { alpha: 0.08, darkText: true, empty: false });
  assert.deepEqual(heatCell(100), { alpha: 0.94, darkText: false, empty: false });
  assert.equal(heatCell(50).darkText, true);
  assert.equal(heatCell(60).darkText, false);
});

test("stacked chart: scaled to the tallest column; percent change", () => {
  const s = scaleStacked([{ label: "a", values: [10, 10] }, { label: "b", values: [30, 10] }, { label: "c", values: [-5, 0] }]);
  assert.deepEqual(s.map((c) => [c.total, c.heights]), [[20, [25, 25]], [40, [75, 25]], [0, [0, 0]]]);
  assert.deepEqual([percentChange(110, 100), percentChange(90, 100), percentChange(5, 0)], [10, -10, null]);
});

test("count-up: eased, keeps decimals, formats per language", () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.ok(easeOutCubic(0.5) > 0.5, "fast start, slow end");
  assert.equal(countUpValue(99.98, 1, 2), 99.98);
  assert.equal(countUpValue(1000, 0), 0);
  assert.deepEqual([decimalsOf(99.98), decimalsOf(41), decimalsOf(2.5)], [2, 0, 1]);
  assert.equal(formatFigure(2400000, 0, "en"), "2,400,000");
  assert.equal(formatFigure(99.98, 2, "en"), "99.98");
  assert.equal(formatFigure(1234.5, 1, "ru"), "1\u00a0234,5");
  assert.equal(formatFigure(48210, 0, "az"), "48.210");
  assert.equal(formatFigure(-0.004, 2, "en"), "0.00");
  assert.equal(formatFigure(-1500, 0, "en"), "-1,500");
});

// ── CSS: the new layer cannot change existing screens ────────────────────────

function selectors(css) {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  for (const m of body.matchAll(/([^{}@;]+)\{/g)) {
    const sel = m[1].trim();
    if (!sel || /^(from|to|\d+%)/.test(sel) || /^(media|keyframes|supports)\b/.test(sel)) continue;
    out.push(...sel.split(",").map((s) => s.trim()).filter(Boolean));
  }
  return out;
}

test("every rule of theme.css and components.css is scoped to [data-ds] (or to UI_STANDARD's html[data-ui-standard])", () => {
  for (const file of ["src/design-system/theme.css", "src/design-system/components.css"]) {
    const list = selectors(read(file)).filter((s) => !/^(0%|100%|50%)$/.test(s));
    assert.ok(list.length >= 5, file);
    // UI-1: the shared scale also sits on html[data-ui-standard] (only while UI_STANDARD is on), and
    // the old full-width input rule only applies without it.
    for (const sel of list) assert.ok(/^(\[data-ds\]|html\[data-ui-standard\]$|html:not\(\[data-ui-standard\]\) \[data-ds\])/.test(sel), `${file}: unscoped selector "${sel}"`);
  }
  const index = read("src/design-system/index.css");
  assert.match(index, /@import "\.\/tokens\.css";\r?\n@import "\.\/typography\.css";/, "existing layers still load first");
  // The existing palette is untouched (Gentelella primary, page font).
  const tokens = read("src/design-system/tokens.css");
  assert.match(tokens, /--erp-color-primary: #1abb9c;/);
  assert.ok(!/--ds-/.test(tokens), "new tokens live in theme.css, not in the existing :root");
});

test("dark theme and compact density redefine the scale; system follows the OS", () => {
  const css = read("src/design-system/theme.css");
  assert.match(css, /\[data-ds\]\[data-ds-theme="dark"\]/);
  assert.match(css, /@media \(prefers-color-scheme: dark\)\s*\{\s*\[data-ds\]\[data-ds-theme="system"\]/);
  assert.match(css, /\[data-ds\]\[data-ds-density="compact"\]/);
  for (const v of ["--ds-radius-xs", "--ds-radius-xl", "--ds-elevation-0", "--ds-elevation-4", "--ds-font-sans", "--ds-control-h"]) {
    assert.ok(css.includes(`${v}:`), v);
  }
  assert.match(read("src/design-system/fonts.ts"), /subsets: \[[^\]]*"latin-ext"[^\]]*"cyrillic"/);
});

// ── Components: no texts of their own, no hard-coded colours ─────────────────

test("components take every text from the caller and colours from tokens", () => {
  const dir = new URL("../src/design-system/components/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".tsx"));
  assert.ok(files.length >= 10);
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), "utf8");
    assert.ok(!/useI18n|@\/i18n/.test(src), `${f} reads i18n itself`);
    assert.ok(!/#[0-9a-fA-F]{6}\b/.test(src), `${f} has a hard-coded colour`);
  }
});

// ── /dev/design gate and texts ───────────────────────────────────────────────

test("/dev/design: 404 unless NEW_UI=true and the visitor is an active admin", () => {
  assert.equal(isNewUiEnabled({}), false);
  assert.equal(isNewUiEnabled({ NEW_UI: "1" }), false);
  assert.equal(isNewUiEnabled({ NEW_UI: " true " }), true);
  const page = read("src/app/dev/design/page.tsx");
  assert.match(page, /if \(!isNewUiEnabled\(\)\) notFound\(\);/);
  assert.match(page, /if \(!user \|\| !isActive \|\| !isAdminRole\(profile\?\.role\)\) notFound\(\);/);
});

test("design system texts exist in az, en and ru with the same placeholders; every key used exists", () => {
  const keys = Object.keys(enMessages.designSystem).sort();
  const params = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [locale, messages] of [["az", azMessages], ["ru", ruMessages]]) {
    assert.deepEqual(Object.keys(messages.designSystem).sort(), keys, locale);
    for (const key of keys) assert.deepEqual(params(messages.designSystem[key]), params(enMessages.designSystem[key]), `${locale}.designSystem.${key}`);
  }
  const src = read("src/app/dev/design/DesignGallery.tsx");
  const used = new Set([...src.matchAll(/"designSystem\.(\w+)"/g)].map((m) => m[1]));
  for (const k of ["light", "dark", "comfortable", "compact", "sampleRow1", "sampleRow2", "sampleRow3", "sampleRow4"]) used.add(k);
  for (const k of ["cmdDashboard", "cmdSales", "cmdInventory", "cmdNewInvoice", "cmdNewCustomer", "cmdToggleTheme"]) used.add(k);
  assert.ok(used.size > 120, String(used.size));
  for (const key of used) assert.ok(keys.includes(key), `designSystem.${key} missing`);
});
