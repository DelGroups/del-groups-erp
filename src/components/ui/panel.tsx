"use client";

import React from "react";
import { cn } from "@/lib/cn";

/** Gentelella x_panel shell — flat 3px radius, compact header rule. */
export const panelShellClass =
  "mb-[var(--erp-space-5)] rounded-[var(--erp-radius-md)] border border-[color:var(--erp-border-default)] bg-[color:var(--erp-bg-panel)] px-[var(--erp-panel-padding-x)] py-[var(--erp-panel-padding-y)] text-[color:var(--erp-text-main)] shadow-[var(--erp-shadow-sm)]";

export interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
}

export function Panel({ title, subtitle, children, actions, footer, className, ...props }: PanelProps) {
  return (
    <div className={cn(panelShellClass, className)} {...props}>
      <div
        className="mb-[var(--erp-space-3)] flex items-center justify-between border-b-2 border-[color:var(--erp-border-default)] py-[5px] pb-[6px]"
      >
        <div className="min-w-0">
          <h2 className="erp-panel-title">
            {title}
            {subtitle ? <small className="erp-panel-subtitle">{subtitle}</small> : null}
          </h2>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      <div className="py-[5px]">{children}</div>
      {footer ? (
        <div className="mt-[var(--erp-space-3)] border-t border-[color:var(--erp-border-default)] pt-[var(--erp-space-3)]">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

export default Panel;
