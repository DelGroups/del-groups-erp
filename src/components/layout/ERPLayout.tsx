"use client";

import React from "react";
import Sidebar from "@/components/Sidebar";
import AppTopBar from "@/components/layout/AppTopBar";
import { cn } from "@/lib/cn";

export interface ERPLayoutProps {
  children: React.ReactNode;
  pageTitle?: string;
  mobileMenuOpen?: boolean;
  onMobileClose?: () => void;
  className?: string;
  contentClassName?: string;
}

/** Gentelella app shell — sidebar, top bar, padded content area. */
export function ERPLayout({
  children,
  pageTitle,
  mobileMenuOpen = false,
  onMobileClose,
  className,
  contentClassName,
}: ERPLayoutProps) {
  return (
    <div className={cn("flex h-screen overflow-hidden bg-[color:var(--erp-bg-main)]", className)}>
      <Sidebar mobileOpen={mobileMenuOpen} onMobileClose={onMobileClose} />

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppTopBar />

        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overscroll-contain px-[var(--erp-content-padding-x)] py-[var(--erp-content-padding-y)]",
            contentClassName
          )}
        >
          {pageTitle ? <h3 className="erp-page-title">{pageTitle}</h3> : null}
          {children}
        </div>
      </main>
    </div>
  );
}

export function ERPPage({
  pageTitle,
  subtitle,
  actions,
  children,
  className,
}: {
  pageTitle: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="mb-[var(--erp-space-5)] flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="erp-page-title !mb-0">{pageTitle}</h3>
          {subtitle ? <p className="mt-1 erp-body-muted">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

export default ERPLayout;
