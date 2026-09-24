import React from "react";
import { cn } from "@/lib/cn";

/**
 * Shared footer under a document's line-item grid (Sales, Purchases, …).
 * On desktop (`lg+`) the secondary panels — tabs, expenses, payments, notes —
 * fill the wide left column and the totals card sits in a fixed-width right
 * rail, so no horizontal space is wasted beside the totals. Below `lg` both
 * stack vertically, totals first.
 *
 *   <DocumentFooter>
 *     <DocumentFooterTotals>…totals card…</DocumentFooterTotals>
 *     <DocumentFooterMain>…tabs / panels…</DocumentFooterMain>
 *   </DocumentFooter>
 */
export function DocumentFooter({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("flex w-full flex-col gap-6 lg:flex-row lg:items-start", className)}>{children}</div>;
}

/** Wide left column — absorbs all remaining width. */
export function DocumentFooterMain({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("flex min-w-0 flex-1 flex-col gap-4", className)}>{children}</div>;
}

/** Fixed-width right rail for the totals card; always rendered on the right on desktop. */
export function DocumentFooterTotals({ className, children }: { className?: string; children: React.ReactNode }) {
  return <aside className={cn("w-full shrink-0 lg:order-last lg:w-[380px]", className)}>{children}</aside>;
}
