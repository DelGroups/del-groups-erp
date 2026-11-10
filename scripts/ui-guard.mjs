// npm run ui:guard (UI-1, docs/ui-standard.md): opens /dev/ui-lab in Chromium and fails when a
// text marked single-line wraps, when a chip, button or cell overflows without a marked
// truncation, when a card's child leaves the card, or when a lab frame scrolls sideways.
//
// UI-5: it also opens /dev/ui-lab?frame=page (one page as the app builds it) at 1440, 1366x768,
// 768 and 360x740 and fails on more than one vertical scroll container, the page scrolling
// sideways, an empty band under the last content, a grid with row actions but no visible actions
// column, a numeric column that is not end-aligned, and a popover clipped by an ancestor (a row
// menu and a lookup in the document lines are opened near the bottom of the window). With
// UI_TEST_EMAIL and UI_TEST_PASSWORD in the environment it signs in and runs the same page checks
// on the main routes (UI_GUARD_ROUTES, comma-separated, overrides the list).
//
// Needs a running app that serves the lab without signing in:
//   UI_STANDARD=true UI_LAB_OPEN=true NEW_UI=true npm run dev      (next dev only)
//   npm run ui:guard -- --url http://localhost:3000 [--screens design/screenshots/ui-lab]
// Playwright is not a dependency: `require("playwright")` must resolve (a global install), or
// UI_GUARD_PLAYWRIGHT points at a playwright package folder. No browser is installed here.
//
// UI-6: before the browser it counts raw <table> elements and imports of the old
// src/components/ui/table.tsx per file (outside src/design-system, src/components/print, the line
// grid and print sheets) and fails when a file has more than scripts/ui-guard-allowlist.json allows
// (rawTable). The allowlist may only shrink: `node scripts/ui-guard-allowlist.mjs --write`.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareAllowlist, sourceEntries } from "./ui-guard-allowlist.mjs";
import { findIssues } from "./ui-guard-checks.mjs";
import { scanSources } from "./ui-guard-rules.mjs";
import { findPageIssues, measurePage } from "./ui-page-checks.mjs";

/**
 * Raw-table check (UI-6): files over their rawTable allowance, as ui-guard issues. `entries` are
 * [path, text] pairs (default: src/), `allowlist` the parsed scripts/ui-guard-allowlist.json.
 */
export function rawTableIssues(allowlist, entries = sourceEntries()) {
  const found = scanSources(entries);
  const { over } = compareAllowlist({ rawTable: allowlist.rawTable ?? {} }, { rawTable: found.rawTable });
  return over.map((o) => ({
    locale: "src",
    rule: "raw-table",
    where: o.file,
    detail: `${o.found} raw table(s) / @/components/ui/table import(s), allowed ${o.allowed}: use StandardGrid (DataGrid) or LineGrid`,
  }));
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require(process.env.UI_GUARD_PLAYWRIGHT || "playwright");
  } catch {
    console.error("ui-guard: playwright not found. Install it globally or set UI_GUARD_PLAYWRIGHT to its folder.");
    process.exit(2);
  }
}

/** Runs in the page: measures every frame of the lab. */
function measure() {
  const out = [];
  const where = (el) => {
    const frame = el.closest("[data-ui-frame]")?.getAttribute("data-ui-frame") ?? "page";
    const cls = typeof el.className === "string" ? el.className.split(/\s+/).filter(Boolean).slice(0, 2).join(".") : "";
    return `${frame} ${el.tagName.toLowerCase()}${cls ? "." + cls : ""}`;
  };
  const text = (el) => (el.textContent ?? "").trim().slice(0, 60);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const frames = [...document.querySelectorAll("[data-ui-frame]")];
  for (const frame of frames) {
    out.push({ kind: "frame", where: frame.getAttribute("data-ui-frame"), scrollWidth: frame.scrollWidth, clientWidth: frame.clientWidth });
    for (const el of frame.querySelectorAll('[data-ui-check="single-line"]')) {
      if (!visible(el)) continue;
      // Line boxes of the text itself (not the padding boxes of inline elements around it).
      const tops = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) if (r.width > 0.5) tops.push(r.top);
      }
      out.push({ kind: "single-line", where: where(el), text: text(el), lineTops: tops });
    }
    for (const el of frame.querySelectorAll(".ds-chip, button, .ds-btn, td, th, .ds-num-cell, .ds-date-cell, .ds-field-label")) {
      if (!visible(el)) continue;
      out.push({
        kind: "overflow",
        where: where(el),
        text: text(el),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        truncating: el.hasAttribute("data-ui-truncate"),
        hasTitle: el.hasAttribute("title"),
      });
    }
    for (const card of frame.querySelectorAll(".ds-card")) {
      const box = card.getBoundingClientRect();
      for (const child of card.querySelectorAll("*")) {
        if (!visible(child)) continue;
        // Content inside a scroll or clip container (a wide table) may be wider than the card.
        let clipped = false;
        for (let p = child.parentElement; p && p !== card; p = p.parentElement) {
          const s = getComputedStyle(p);
          if (s.overflowX !== "visible" || s.overflowY !== "visible") {
            clipped = true;
            break;
          }
        }
        if (clipped) continue;
        const r = child.getBoundingClientRect();
        out.push({ kind: "containment", where: where(child), box: { left: box.left, right: box.right, bottom: box.bottom }, child: { left: r.left, right: r.right, bottom: r.bottom } });
      }
    }
  }
  return out;
}

/** Page sizes of the page checks (UI-5): desktop, laptop, tablet, phone. */
export const PAGE_SIZES = [
  [1440, 900],
  [1366, 768],
  [768, 1024],
  [360, 740],
];

/** Signed-in routes of the page checks (the main lists and forms). */
// Settings pages (SET-1): the hub (SETTINGS_V2) or company profile, and every page of the settings list.
export const SETTINGS_ROUTES = ["/settings", "/settings/company", "/settings/roles", "/users", "/settings/commissions", "/settings/initial-setup", "/settings/tax-payroll", "/settings/audit", "/settings/procurement", "/settings/imports", "/settings/crm", "/settings/activity-types", "/settings/barcode", "/settings/stock-integrity", "/settings/modules", "/settings/studio", "/settings/ai", "/settings/backup"];
export const MAIN_ROUTES = ["/", "/sales", "/purchases", "/dashboard/payments", "/customers", "/products", "/sales/new", "/purchases/new", "/imports", "/imports/new", ...SETTINGS_ROUTES];

const settle = (page, ms = 1200) => page.waitForTimeout(ms);
const scrollRoot = (page, fraction) =>
  page.evaluate((f) => {
    const r = document.querySelector("[data-scroll-root]");
    if (r) r.scrollTop = (r.scrollHeight - r.clientHeight) * f;
  }, fraction);

/** Page checks at the top, scrolled, and (lab frame) with a row menu and a lookup open low down. */
async function pagePass(page, label, { openOverlays }) {
  const out = [];
  const take = async (state) => {
    for (const i of findPageIssues(await page.evaluate(measurePage))) out.push({ ...i, rule: i.check, where: `${label} [${state}] ${i.where}` });
  };
  await take("top");
  await scrollRoot(page, 0.35);
  await settle(page, 300);
  await take("scrolled");
  if (openOverlays) {
    const height = page.viewportSize().height;
    for (const trigger of await page.$$(".ds-row-menu-trigger")) {
      const box = await trigger.boundingBox();
      if (box && box.y > height * 0.6 && box.y < height - 40) {
        await trigger.click();
        await page.waitForSelector("[role='menu']", { timeout: 5000 }).catch(() => undefined);
        await take("row menu open");
        await page.keyboard.press("Escape");
        break;
      }
    }
    await page.evaluate(() => {
      const sec = document.querySelector("[data-ui-frame='page-lines']");
      const r = document.querySelector("[data-scroll-root]");
      if (sec && r) r.scrollTop = sec.offsetTop - r.clientHeight * 0.55;
    });
    await settle(page, 300);
    const lookup = await page.$("[data-ui-frame='page-lines'] .ds-combobox-trigger");
    if (lookup) {
      await lookup.click();
      await settle(page, 300);
      await take("lookup open");
      await page.keyboard.press("Escape");
    }
  }
  return out;
}

async function signIn(page, base) {
  await page.goto(`${base}/login`, { waitUntil: "load", timeout: 120000 });
  await page.fill("input[type=email]", process.env.UI_TEST_EMAIL);
  await page.fill("input[type=password]", process.env.UI_TEST_PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }), page.click("button[type=submit]")]);
}

async function main() {
  const base = arg("url", "http://localhost:3000");
  const screens = arg("screens", null);
  const allowlist = JSON.parse(readFileSync(fileURLToPath(new URL("./ui-guard-allowlist.json", import.meta.url)), "utf8"));
  let issues = rawTableIssues(allowlist);
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  try {
    for (const locale of ["az", "ru"]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      // The app's language cookie (src/i18n/types.ts LOCALE_COOKIE).
      await context.addCookies([{ name: "erp_locale", value: locale, url: base }]);
      const page = await context.newPage();
      await page.goto(`${base}/dev/ui-lab`, { waitUntil: "load", timeout: 120000 });
      await page.waitForSelector("[data-ui-frame]", { timeout: 120000 });
      await page.evaluate(() => document.fonts?.ready);
      const found = findIssues(await page.evaluate(measure));
      issues = issues.concat(found.map((i) => ({ ...i, locale })));
      if (screens) {
        mkdirSync(screens, { recursive: true });
        const names = await page.$$eval("[data-ui-frame]", (els) => els.map((el) => el.getAttribute("data-ui-frame")));
        for (const name of names) {
          // A locator re-finds the frame if the page re-rendered meanwhile (next dev).
          await page.locator(`[data-ui-frame="${name}"]`).screenshot({ path: join(screens, `${locale}-${name}.png`) });
        }
      }
      await context.close();
    }
    // UI-5: page checks on the lab's page frame (no sign-in needed).
    for (const locale of ["az", "ru"]) {
      for (const [width, height] of PAGE_SIZES) {
        const context = await browser.newContext({ viewport: { width, height } });
        await context.addCookies([{ name: "erp_locale", value: locale, url: base }]);
        const page = await context.newPage();
        await page.goto(`${base}/dev/ui-lab?frame=page`, { waitUntil: "load", timeout: 120000 });
        await page.waitForSelector("[data-scroll-root]", { timeout: 120000 });
        await page.evaluate(() => document.fonts?.ready);
        await settle(page);
        if (screens) await page.screenshot({ path: join(screens, `${locale}-page-${width}.png`) });
        issues = issues.concat((await pagePass(page, `page-frame ${width}x${height}`, { openOverlays: true })).map((i) => ({ ...i, locale })));
        await context.close();
      }
    }
    // IMP-4: the import form with sample data (lines grid, costs grid, rates) on the same checks.
    // No overlays: the lab's lookups have no database behind them.
    // IMP-5: the stage bar and the payment dialog (?frame=pay) on the same checks.
    for (const [frame, ready] of [["import", "[data-ui-frame=import] .ds-line-grid"], ["pay", "[data-ui-frame=payment-dialog]"]]) {
    for (const locale of ["az", "ru"]) {
      for (const [width, height] of PAGE_SIZES) {
        const context = await browser.newContext({ viewport: { width, height } });
        await context.addCookies([{ name: "erp_locale", value: locale, url: base }]);
        const page = await context.newPage();
        await page.goto(`${base}/dev/ui-lab?frame=${frame}`, { waitUntil: "load", timeout: 120000 });
        await page.waitForSelector(ready, { timeout: 120000 });
        await page.evaluate(() => document.fonts?.ready);
        await settle(page);
        if (screens) await page.screenshot({ path: join(screens, `${locale}-${frame}-${width}.png`) });
        issues = issues.concat((await pagePass(page, `${frame}-frame ${width}x${height}`, { openOverlays: false })).map((i) => ({ ...i, locale })));
        await context.close();
      }
    }
    }
    // Signed-in routes, only with a test account from the environment (never stored in the repo).
    if (process.env.UI_TEST_EMAIL && process.env.UI_TEST_PASSWORD) {
      const routes = process.env.UI_GUARD_ROUTES ? process.env.UI_GUARD_ROUTES.split(",").map((r) => r.trim()).filter(Boolean) : MAIN_ROUTES;
      for (const [width, height] of [
        [1366, 768],
        [360, 740],
      ]) {
        const context = await browser.newContext({ viewport: { width, height } });
        const page = await context.newPage();
        await signIn(page, base);
        for (const route of routes) {
          await page.goto(`${base}${route}`, { waitUntil: "load", timeout: 120000 });
          await page.waitForSelector("[data-scroll-root]", { timeout: 60000 }).catch(() => undefined);
          await settle(page, 2500);
          const slug = route.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home";
          if (screens) await page.screenshot({ path: join(screens, `route-${width}-${slug}.png`) });
          issues = issues.concat((await pagePass(page, `${route} ${width}x${height}`, { openOverlays: false })).map((i) => ({ ...i, locale: "az" })));
        }
        await context.close();
      }
    } else {
      console.log("ui-guard: signed-in routes skipped (set UI_TEST_EMAIL and UI_TEST_PASSWORD to run them)");
    }
  } finally {
    await browser.close();
  }
  for (const i of issues) console.log(`${i.locale} ${i.rule.padEnd(14)} ${i.where}  ${i.detail}`);
  console.log(issues.length ? `ui-guard: ${issues.length} problem(s)` : "ui-guard: no problems");
  process.exitCode = issues.length ? 1 : 0;
}

// Run only as a script, so tests can import rawTableIssues.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
