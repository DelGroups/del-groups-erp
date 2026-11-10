// SCROLL-1: one vertical scrollbar per page and no empty band under the shell.
// The window itself never scrolls while a shell is on screen; only the content area
// ([data-scroll-root]), a dialog taller than the window, and grids sideways may scroll.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { layerClassName } from "../src/design-system/theme.ts";
import { findPageIssues } from "../scripts/ui-page-checks.mjs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/** Body of the first unlayered `selector {` rule in a stylesheet. */
function rule(css, selector) {
  const at = css.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `${selector} rule exists`);
  return css.slice(at, css.indexOf("}", at));
}

test("the overlay layer under <body> takes only font classes from its scope, never a box", () => {
  // ViewScope's frame: these classes on the layer made <body> 40px taller than the window.
  assert.equal(layerClassName("mx-auto w-full max-w-[100rem] rounded-[var(--ds-radius-xl)] p-3 md:p-5"), "ds-layer");
  assert.equal(layerClassName("mx-auto max-w-5xl p-4 md:p-6 font-x __variable_abc __className_def"), "ds-layer font-x __variable_abc __className_def");
  assert.equal(layerClassName("ds-scope-contents"), "ds-layer");
  const css = rule(read("src/design-system/components.css"), "[data-ds].ds-layer");
  for (const decl of ["margin: 0", "padding: 0", "height: 0"]) assert.match(css, new RegExp(decl), decl);
});

test("while a shell is on screen the window is locked; the content area is the one scroller", () => {
  const css = read("src/app/globals.css");
  assert.match(css, /html:has\(body \[data-scroll-root\]\),\s*html:has\(body \[data-scroll-root\]\) body \{[^}]*overflow: hidden;/);
  assert.match(rule(css, ".ds-scroll-root"), /position: relative;/, "absolute children (sr-only labels) stay inside the scroller");
  // 100vh is taller than the visible screen on phones (address bar): the body must use dvh.
  assert.match(read("src/app/layout.tsx"), /<body className=\{`[^`]*min-h-dvh/);
  assert.doesNotMatch(read("src/app/layout.tsx"), /<body className=\{`[^`]*min-h-screen/);
  for (const f of ["src/components/shell/NewShell.tsx", "src/components/layout/ERPLayout.tsx"]) {
    assert.match(read(f), /data-scroll-root=""/, `${f} has the content scroller`);
    assert.match(read(f), /h-dvh/, `${f} fills the screen, not more`);
  }
});

test("a dialog taller than the window scrolls inside itself", () => {
  const css = rule(read("src/app/globals.css"), ".app-modal");
  assert.match(css, /max-height: calc\(100dvh - 2rem\);/);
  assert.match(css, /overflow-y: auto;/);
  // Unlayered "overflow: hidden" here beat every Tailwind overflow-y-auto on a dialog.
  assert.doesNotMatch(css, /\boverflow: hidden;/);
});

test("form action bars stick with the shared class (room for the AI button, scroller edge offset)", () => {
  const css = read("src/app/globals.css");
  assert.match(rule(css, ".erp-sticky-actions"), /bottom: var\(--ds-sticky-bottom, 0px\);/);
  assert.match(read("src/components/ai/AiAssistantWidget.tsx"), /erp-ai-fab fixed/);
  assert.match(css, /html:has\(\.ds-scroll-root-tabbar\) \.erp-ai-fab \{\s*bottom: calc\(5rem/);
  const offenders = execSync('git grep -l "sticky bottom-0 " -- "src/**/*.tsx" || true', { cwd: new URL("..", import.meta.url) })
    .toString()
    .trim();
  assert.equal(offenders, "", "use erp-sticky-actions for a sticky form footer");
});

test("on a phone the list header scrolls away instead of covering half the screen", () => {
  const css = read("src/app/globals.css");
  assert.match(css, /@media \(max-width: 767\.98px\) \{\s*\.ds-list-chrome-bar \{\s*position: relative;/);
  assert.match(read("src/components/layout/ListPageChrome.tsx"), /removeProperty\("--ds-sticky-top"\)/);
});

test("ui:guard flags a window taller than the screen", () => {
  const ok = { viewportWidth: 1280, viewportHeight: 800, pageScrollWidth: 1280, pageScrollHeight: 800, verticalScrollers: [{ where: "root", isRoot: true }], root: null, grids: [], popovers: [] };
  assert.deepEqual(findPageIssues(ok), []);
  assert.deepEqual(findPageIssues({ ...ok, pageScrollHeight: 840 }).map((i) => i.check), ["window-scroll"]);
  // Older measurements without heights are not flagged.
  assert.deepEqual(findPageIssues({ ...ok, pageScrollHeight: undefined, viewportHeight: undefined }), []);
});
