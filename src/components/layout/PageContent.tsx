"use client";

import React from "react";
import { cn } from "@/lib/cn";

interface PageContentProps {
  children: React.ReactNode;
  className?: string;
}

/** Standard enterprise-density page content wrapper. */
export default function PageContent({ children, className }: PageContentProps) {
  return (
    <main className={cn("app-page-content flex-1 space-y-3 overflow-y-auto md:space-y-4", className)}>
      {children}
    </main>
  );
}
