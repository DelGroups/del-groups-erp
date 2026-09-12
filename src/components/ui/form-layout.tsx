"use client";

import React from "react";

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
  /** Reserve space for a fixed bottom action bar rendered inside children. */
  withStickyFooter?: boolean;
  /** Override default content area classes (default: app-page-content space-y-4). */
  contentClassName?: string;
  children: React.ReactNode;
}

export function FormLayout({
  title,
  subtitle,
  actions,
  fullWidth = false,
  withStickyFooter = false,
  contentClassName,
  children,
}: FormLayoutProps) {
  const widthClass = fullWidth ? "w-full" : "w-full max-w-7xl mx-auto";

  return (
    <div
      className={`min-h-full dark:bg-[color:var(--app-bg)] ${withStickyFooter ? "pb-20" : "pb-12"}`}
    >
      <div className="border-b border-app bg-app-card px-3 py-3 shadow-sm md:px-4 lg:px-5">
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

      <div className={`${widthClass} ${contentClassName ?? "app-page-content space-y-4"}`}>
        {children}
      </div>
    </div>
  );
}
