"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";

interface DocumentPageHeaderProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  createLabel?: string;
  onCreate?: () => void;
  createDisabled?: boolean;
  extraActions?: React.ReactNode;
  backLink?: { href: string; label: string };
}

export default function DocumentPageHeader({
  icon,
  title,
  description,
  createLabel,
  onCreate,
  createDisabled,
  extraActions,
  backLink,
}: DocumentPageHeaderProps) {
  return (
    <header className="app-glass flex flex-col justify-between gap-4 border-b border-app px-6 py-4 md:flex-row md:items-center">
      <div>
        {backLink && (
          <Link
            href={backLink.href}
            className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-app-accent hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {backLink.label}
          </Link>
        )}
        <h2 className="flex items-center gap-2 text-xl font-bold text-app">
          {icon}
          {title}
        </h2>
        <p className="text-sm text-app-muted">{description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 self-start">
        {extraActions}
        {createLabel && onCreate && (
          <button
            type="button"
            onClick={onCreate}
            disabled={createDisabled}
            className="btn-primary"
          >
            <Plus className="h-4 w-4" />
            {createLabel}
          </button>
        )}
      </div>
    </header>
  );
}
