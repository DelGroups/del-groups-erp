"use client";

import React from "react";
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
 * List page shell: fixed header + filters, scrollable table body.
 * Fills the ERP content viewport so rows never bleed through the chrome band.
 */
export function ListPageChrome({
  header,
  filters,
  children,
  className,
  contentClassName,
}: ListPageChromeProps) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden",
        "h-[calc(100dvh-var(--erp-topbar-height)-2*var(--erp-content-padding-y))]",
        className
      )}
    >
      <div
        className={cn(
          "shrink-0 -mx-[var(--erp-content-padding-x)] border-b border-[color:var(--erp-border-default)]",
          "bg-[color:var(--erp-bg-main)] px-[var(--erp-content-padding-x)] shadow-[var(--erp-shadow-sm)]"
        )}
      >
        <div className="pt-1">{header}</div>
        {filters ? <div className="pb-3 pt-3">{filters}</div> : <div className="pb-1" />}
      </div>

      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain",
          "space-y-3 pt-3 md:space-y-4",
          contentClassName
        )}
      >
        {children}
      </div>
    </div>
  );
}

export default ListPageChrome;
