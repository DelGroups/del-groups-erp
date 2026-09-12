"use client";

import React from "react";
import Link from "next/link";

export interface FormLayoutBreadcrumb {
  label: string;
  href?: string;
}

export interface FormLayoutProps {
  title: string;
  subtitle?: string;
  breadcrumbs: FormLayoutBreadcrumb[];
  actions?: React.ReactNode;
  /** When true, content spans the full viewport width (no max-w-7xl cap). */
  fullWidth?: boolean;
  children: React.ReactNode;
}

export function FormLayout({
  title,
  subtitle,
  breadcrumbs,
  actions,
  fullWidth = false,
  children,
}: FormLayoutProps) {
  const widthClass = fullWidth ? "w-full" : "w-full max-w-7xl mx-auto";

  return (
    <div className="min-h-full bg-slate-50/50 pb-16 dark:bg-[color:var(--app-bg)]">
      <div className="border-b border-slate-200 bg-white px-6 py-4 shadow-sm dark:border-app dark:bg-app-card">
        <div className={`${widthClass} flex items-center justify-between`}>
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-app-muted">
              {breadcrumbs.map((crumb, index) => (
                <span key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                  {index > 0 ? <span>/</span> : null}
                  {crumb.href ? (
                    <Link href={crumb.href} className="hover:text-blue-600 dark:hover:text-app-accent">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="text-slate-700 dark:text-app">{crumb.label}</span>
                  )}
                </span>
              ))}
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-app">{title}</h1>
            {subtitle ? (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-app-muted">{subtitle}</p>
            ) : null}
          </div>
          {actions ? <div className="flex items-center gap-3">{actions}</div> : null}
        </div>
      </div>

      <main className={`${widthClass} space-y-6 px-6 py-6`}>{children}</main>
    </div>
  );
}
