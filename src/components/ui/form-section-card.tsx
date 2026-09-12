"use client";

import React from "react";

interface FormSectionCardProps {
  title: string;
  children: React.ReactNode;
  className?: string;
}

export function FormSectionCard({ title, children, className = "" }: FormSectionCardProps) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-app dark:bg-app-card ${className}`}
    >
      <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-4 dark:border-app dark:bg-app-card-hover/50">
        <h3 className="text-base font-semibold text-slate-800 dark:text-app">{title}</h3>
      </div>
      <div className="space-y-5 p-6">{children}</div>
    </div>
  );
}
