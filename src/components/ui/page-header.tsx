"use client";

import React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

export type PageHeaderCrumb = { href?: string; label: string };

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  breadcrumbs?: PageHeaderCrumb[];
  actions?: React.ReactNode;
  className?: string;
}

export default function PageHeader({
  title,
  subtitle,
  icon,
  breadcrumbs,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "app-glass flex flex-col justify-between gap-4 border-b border-app px-6 py-4 md:flex-row md:items-center",
        className
      )}
    >
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <nav className="mb-2 flex flex-wrap items-center gap-1 text-xs font-semibold text-app-muted">
            {breadcrumbs.map((crumb, index) => (
              <span key={`${crumb.label}-${index}`} className="inline-flex items-center gap-1">
                {index > 0 ? <ChevronRight className="h-3 w-3" /> : null}
                {crumb.href ? (
                  <Link href={crumb.href} className="text-app-accent hover:underline">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-app">{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
        ) : null}
        <h2 className="flex items-center gap-2 text-xl font-bold text-app">
          {icon}
          {title}
        </h2>
        {subtitle ? <p className="text-sm text-app-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 self-start">{actions}</div> : null}
    </header>
  );
}
