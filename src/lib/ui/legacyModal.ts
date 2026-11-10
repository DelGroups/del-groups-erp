/*
 * Which button Escape presses for the old `.app-modal` dialogs (UI-7 live check, audit OVL-01).
 * Used by src/components/ui/LegacyModalEscape.tsx; plain DOM, so `node --test` covers it.
 */

/** Elements that handle Escape themselves (design-system overlays, comboboxes). */
export const OWN_ESCAPE_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[role="listbox"]',
  "[data-radix-popper-content-wrapper]",
].join(", ");

/** The × button of an `.app-modal`: a button whose content is the lucide X icon. */
export const LEGACY_CLOSE_SELECTOR = "button:has(> svg.lucide-x), button:has(> svg.lucide-x-icon)";

function visible(el: Element): boolean {
  return el.getClientRects().length > 0;
}

/** The close button of the topmost visible `.app-modal`, or null when Escape is not ours to handle. */
export function legacyModalClose(doc: Document): HTMLButtonElement | null {
  if ([...doc.querySelectorAll(OWN_ESCAPE_SELECTOR)].some(visible)) return null;
  const modals = [...doc.querySelectorAll(".app-modal")].filter(visible);
  const top = modals.at(-1);
  if (!top) return null;
  const button = top.querySelector<HTMLButtonElement>(LEGACY_CLOSE_SELECTOR);
  return button && !button.disabled ? button : null;
}
