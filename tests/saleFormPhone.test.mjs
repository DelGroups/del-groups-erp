// Live check (UI-7): on a 390 px phone the new sale form scrolled sideways, because the items
// header (title + "Məhsul / Komplekt Seçimi" + "Sətir əlavə et") could not wrap or shrink.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const form = readFileSync(new URL("../src/modules/sales/components/InvoiceForm.tsx", import.meta.url), "utf8");

test("the sale items header wraps and its buttons shrink with an ellipsis", () => {
  assert.match(form, /<CardHeader className="flex-row flex-wrap items-center justify-between/);
  assert.match(form, /<div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">\s*\{!polywoodOnly \? \(\s*<Button type="button" size="sm" className="min-w-0 max-w-full" onClick=\{openProductSelectorModal\}>/);
  assert.match(form, /<Button type="button" variant="secondary" size="sm" className="min-w-0 max-w-full" onClick=\{addRow\}>\s*<Plus[^>]*\/>\s*<span className="truncate">/);
});
