"use client";

import React from "react";
import { cn } from "@/lib/cn";

export interface FormLayoutBreadcrumb {
  label: string;
  href?: string;
}

export interface FormLayoutProps {
  title: string;
  subtitle?: string;
  /** @deprecated Global breadcrumbs in PageLayout replace per-page trails. */
  breadcrumbs?: FormLayoutBreadcrumb[];
  actions?: React.ReactNode;
  /** When true, content spans the full viewport width (no max-w-7xl cap). */
  fullWidth?: boolean;
  /** Override default content area classes (default: space-y-4). */
  contentClassName?: string;
  children: React.ReactNode;
}

/** Break out of ERPLayout padding so header and body share the same width. */
const formShellClass =
  "-mx-[var(--erp-content-padding-x)] w-[calc(100%+2*var(--erp-content-padding-x))]";
const formInsetClass = "px-[var(--erp-content-padding-x)]";

export function FormLayout({
  title,
  subtitle,
  actions,
  fullWidth = false,
  contentClassName,
  children,
}: FormLayoutProps) {
  const widthClass = fullWidth ? "w-full" : "w-full max-w-7xl mx-auto";

  return (
    <div className={cn("min-h-full pb-8", formShellClass)}>
      <div className={cn("border-b border-app bg-app-card py-3 shadow-sm", formInsetClass)}>
        <div className={`${widthClass} flex items-center justify-between gap-4`}>
          <div className="min-w-0">
            <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-app md:text-xl">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-0.5 text-sm text-slate-700 dark:text-app-muted">{subtitle}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
        </div>
      </div>

      <div
        className={cn(
          widthClass,
          formInsetClass,
          "py-6",
          contentClassName ?? "space-y-4"
        )}
      >
        {children}
      </div>
    </div>
  );
}
