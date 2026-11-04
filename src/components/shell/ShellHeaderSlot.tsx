"use client";

import React, { createContext, useContext } from "react";
import { createPortal } from "react-dom";

/**
 * Page actions in the shell header (UI-5): a page puts a small icon action (home's "Customise")
 * into the new shell's top bar instead of a row of its own above the content. Outside the new
 * shell there is no slot and the action renders where the page placed it (in a div with `fallbackClassName`).
 */
export const ShellHeaderSlotContext = createContext<HTMLElement | null>(null);

export function ShellHeaderActions({ children, fallbackClassName }: { children: React.ReactNode; fallbackClassName?: string }) {
  const slot = useContext(ShellHeaderSlotContext);
  if (slot) return createPortal(children, slot);
  return <div className={fallbackClassName}>{children}</div>;
}
