"use client";

import React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import type { BreadcrumbItem } from "@/lib/navigation/breadcrumbs";

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className={cn("min-w-0", className)}>
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="inline-flex min-w-0 items-center gap-1">
            {index > 0 ? (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-app-muted" aria-hidden />
            ) : null}
            {item.href ? (
              <Link
                href={item.href}
                className="truncate font-medium text-slate-700 transition-colors hover:text-blue-600 dark:text-app-muted dark:hover:text-app-accent"
              >
                {item.label}
              </Link>
            ) : (
              <span className="truncate font-semibold text-slate-900 dark:text-app" aria-current="page">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
