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

/** Sticky page chrome for long ERP list views — header + filters stay visible while the table scrolls. */
export function ListPageChrome({
  header,
  filters,
  children,
  className,
  contentClassName,
}: ListPageChromeProps) {
  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div
        className={cn(
          "sticky top-0 z-[var(--erp-z-sticky)] -mx-[var(--erp-content-padding-x)] border-b border-[color:var(--erp-border-default)]",
          "bg-[color:var(--erp-bg-main)]/95 px-[var(--erp-content-padding-x)] shadow-[var(--erp-shadow-sm)] backdrop-blur-md"
        )}
      >
        <div className="pt-1">{header}</div>
        {filters ? <div className="pb-3 pt-3">{filters}</div> : <div className="pb-1" />}
      </div>

      <div className={cn("space-y-3 pt-3 md:space-y-4", contentClassName)}>{children}</div>
    </div>
  );
}

export default ListPageChrome;
