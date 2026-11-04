"use client";

import React, { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/cn";

export interface ListPageChromeProps {
  /** Page title row (PageHeader with variant="chrome" or custom header). */
  header: React.ReactNode;
  /** Optional filter / search / tab strip — stays pinned with the header. */
  filters?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

/**
 * List page shell (UI-5, docs/ui-standard.md "Page scroll"): the header and filters stick to the
 * top of the shell's one vertical scroller; the content below flows with the page (no box of its
 * own, no fixed height, so no second scrollbar and no empty band). The header's height goes to
 * --ds-sticky-top, where a DataGrid header sticks right below it.
 */
export function ListPageChrome({ header, filters, children, className, contentClassName }: ListPageChromeProps) {
  const root = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = bar.current;
    const host = root.current;
    if (!el || !host) return;
    // The bar sticks at minus the scroller's padding (globals.css): what is left of it below the
    // scroller's edge is where a grid header sticks.
    const set = () => host.style.setProperty("--ds-sticky-top", `${Math.round(el.getBoundingClientRect().height + (parseFloat(getComputedStyle(el).top) || 0))}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={root} className={cn("ds-list-chrome flex min-w-0 flex-col", className)}>
      <div
        ref={bar}
        className={cn(
          "ds-list-chrome-bar -mx-[var(--erp-content-padding-x)] border-b border-[color:var(--erp-border-default)]",
          "bg-[color:var(--erp-bg-main)] px-[var(--erp-content-padding-x)] shadow-[var(--erp-shadow-sm)]"
        )}
      >
        <div className="pt-1">{header}</div>
        {filters ? <div className="pb-3 pt-3">{filters}</div> : <div className="pb-1" />}
      </div>

      <div className={cn("min-w-0 space-y-3 pt-3 md:space-y-4", contentClassName)}>{children}</div>
    </div>
  );
}

export default ListPageChrome;
