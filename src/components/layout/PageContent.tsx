"use client";

import React from "react";
import { cn } from "@/lib/cn";

interface PageContentProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Standard enterprise-density page content wrapper. It never scrolls itself (UI-5): the shell's
 * content area is the page's one vertical scroller, so sticky headers inside it work.
 */
export default function PageContent({ children, className }: PageContentProps) {
  return <div className={cn("app-page-content space-y-3 md:space-y-4", className)}>{children}</div>;
}
