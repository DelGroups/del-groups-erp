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
  /** `chrome` — inside ListPageChrome (no extra border/padding). */
  variant?: "default" | "chrome";
  className?: string;
}

export default function PageHeader({
  title,
  subtitle,
  icon,
  breadcrumbs,
  actions,
  variant = "default",
  className,
}: PageHeaderProps) {
  const isChrome = variant === "chrome";

  return (
    <header
      className={cn(
        "flex flex-col justify-between gap-3 md:flex-row md:items-center",
        isChrome
          ? "bg-transparent px-0 py-0"
          : "app-glass border-b border-app px-3 py-3 md:px-4 lg:px-5",
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
