"use client";

import { useEffect } from "react";

/*
 * Escape closes the old `.app-modal` dialogs (UI-7 live check, audit OVL-01). About 40 screens draw
 * their own `.app-modal` box with an × (lucide X) button and no keyboard handling; until each moves
 * to the design-system Dialog (OVL-1, phases 3–N), one listener does what the × does.
 *
 * It only acts when nothing else owns Escape: an open Radix dialog, menu, listbox or popover closes
 * itself first, and a key event another handler already took (defaultPrevented) is left alone. It
 * clicks the × of the topmost visible `.app-modal`, so the screen's own close logic runs
 * (a disabled × while saving keeps the dialog open). A dialog without an × is left open.
 */

import { legacyModalClose } from "@/lib/ui/legacyModal";

/** Mounted once in the root layout. */
export default function LegacyModalEscape() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      const close = legacyModalClose(document);
      if (!close) return;
      event.preventDefault();
      close.click();
    };
    // Bubble phase: handlers inside the page (an input, a screen's own Escape) run first.
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
