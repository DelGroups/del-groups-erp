// Live check (UI-7, audit OVL-01): Escape did not close the old `.app-modal` dialogs. One listener
// in the root layout clicks the × of the topmost one, unless a design-system overlay owns Escape.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LEGACY_CLOSE_SELECTOR, OWN_ESCAPE_SELECTOR, legacyModalClose } from "../src/lib/ui/legacyModal.ts";

const el = (attrs = {}) => ({ getClientRects: () => (attrs.hidden ? [] : [{}]), ...attrs });
function fakeDoc({ own = [], modals = [] }) {
  return {
    querySelectorAll: (sel) => (sel === OWN_ESCAPE_SELECTOR ? own : sel === ".app-modal" ? modals : []),
  };
}
const modal = (button) => el({ querySelector: (sel) => (sel === LEGACY_CLOSE_SELECTOR ? button : null) });

test("Escape picks the × of the topmost visible .app-modal", () => {
  const first = { disabled: false, id: 1 };
  const second = { disabled: false, id: 2 };
  assert.equal(legacyModalClose(fakeDoc({ modals: [modal(first), modal(second)] })), second);
  assert.equal(legacyModalClose(fakeDoc({ modals: [modal(first), el({ hidden: true })] })), first, "hidden modals are skipped");
  assert.equal(legacyModalClose(fakeDoc({ modals: [] })), null);
});

test("Escape is left to open design-system overlays, a disabled × and dialogs without one", () => {
  const button = { disabled: false };
  assert.equal(legacyModalClose(fakeDoc({ own: [el()], modals: [modal(button)] })), null, "a Radix dialog or menu is open");
  assert.equal(legacyModalClose(fakeDoc({ own: [el({ hidden: true })], modals: [modal(button)] })), button);
  assert.equal(legacyModalClose(fakeDoc({ modals: [modal({ disabled: true })] })), null, "saving: the × is disabled");
  assert.equal(legacyModalClose(fakeDoc({ modals: [modal(null)] })), null);
  assert.match(LEGACY_CLOSE_SELECTOR, /svg\.lucide-x/);
});

test("the listener is mounted once in the root layout and respects other handlers", () => {
  const layout = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
  assert.equal((layout.match(/<LegacyModalEscape \/>/g) ?? []).length, 1);
  const src = readFileSync(new URL("../src/components/ui/LegacyModalEscape.tsx", import.meta.url), "utf8");
  assert.match(src, /event\.defaultPrevented/);
  assert.match(src, /close\.click\(\)/);
});
