"use client";

import React from "react";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
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
        "app-glass flex flex-col justify-between gap-3 border-b border-app px-3 py-3 md:flex-row md:items-center md:px-4 lg:px-5",
        className
      )}
    >
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <Breadcrumbs items={breadcrumbs} className="mb-2" />
        ) : null}
        <h2 className="flex items-center gap-2 text-lg font-bold text-app md:text-xl">
          {icon}
          {title}
        </h2>
        {subtitle ? <p className="text-sm text-slate-700 dark:text-app-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 self-start">{actions}</div> : null}
    </header>
  );
}
