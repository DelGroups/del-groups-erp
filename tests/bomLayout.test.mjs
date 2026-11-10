// Live check (UI-7): the BOM page scrolled sideways at 1366 px; a long product name in a select
// widened its grid column. Columns are minmax(0, …) now, so they never grow past the page.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../src/modules/production/components/ProductionBomPage.tsx", import.meta.url), "utf8");

test("BOM columns shrink instead of widening the page", () => {
  assert.match(page, /xl:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1\.2fr\)\]/);
  assert.match(page, /md:grid-cols-\[minmax\(0,1\.4fr\)_minmax\(0,0\.6fr\)_minmax\(0,1fr\)_auto\]/);
  assert.equal((page.match(/<section className="min-w-0 /g) ?? []).length, 2);
  assert.doesNotMatch(page, /grid-cols-\[1fr_1\.2fr\]/);
});
