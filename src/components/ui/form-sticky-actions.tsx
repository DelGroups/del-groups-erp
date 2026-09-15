"use client";

import React from "react";
import { cn } from "@/lib/cn";

/**
 * Unified ERP form action row — place at the top of each form (or in FormLayout / drawer header).
 * Never pins to the viewport bottom.
 */
export function FormActionsBar({
  children,
  className,
  fullWidth = false,
}: {
  children: React.ReactNode;
  className?: string;
  /** Stretch to the full content width on wide page forms. */
  fullWidth?: boolean;
}) {
  return (
    <div
      data-form-actions
      className={cn(
        "flex flex-wrap items-center justify-end gap-2 rounded-[var(--erp-radius-md)] border border-[color:var(--erp-border-default)] bg-[color:var(--erp-bg-panel)] px-4 py-2.5 shadow-[var(--erp-shadow-sm)]",
        fullWidth && "w-full",
        className
      )}
    >
      {children}
    </div>
  );
}

/** @deprecated Use FormActionsBar at the top of forms instead of a bottom sticky bar. */
export const FormStickyActions = FormActionsBar;
