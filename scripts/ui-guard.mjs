// npm run ui:guard (UI-1, docs/ui-standard.md): opens /dev/ui-lab in Chromium and fails when a
// text marked single-line wraps, when a chip, button or cell overflows without a marked
// truncation, when a card's child leaves the card, or when a lab frame scrolls sideways.
//
// Needs a running app that serves the lab without signing in:
//   UI_STANDARD=true UI_LAB_OPEN=true NEW_UI=true npm run dev      (next dev only)
//   npm run ui:guard -- --url http://localhost:3000 [--screens design/screenshots/ui-lab]
// Playwright is not a dependency: `require("playwright")` must resolve (a global install), or
// UI_GUARD_PLAYWRIGHT points at a playwright package folder. No browser is installed here.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { findIssues } from "./ui-guard-checks.mjs";

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

async function main() {
  const base = arg("url", "http://localhost:3000");
  const screens = arg("screens", null);
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  let issues = [];
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
  } finally {
    await browser.close();
  }
  for (const i of issues) console.log(`${i.locale} ${i.rule.padEnd(14)} ${i.where}  ${i.detail}`);
  console.log(issues.length ? `ui-guard: ${issues.length} problem(s)` : "ui-guard: no problems");
  process.exitCode = issues.length ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
