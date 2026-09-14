"use client";

import React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-[var(--erp-radius-md)] border px-2 py-0.5 text-[length:var(--erp-text-xs)] font-[var(--erp-font-weight-semibold)] uppercase tracking-wide",
  {
    variants: {
      variant: {
        primary:
          "border-[color:var(--erp-color-primary)]/30 bg-[color:var(--erp-color-primary)]/10 text-[color:var(--erp-color-primary)]",
        secondary:
          "border-[color:var(--erp-color-secondary)]/30 bg-[color:var(--erp-color-secondary)]/10 text-[color:var(--erp-color-secondary)]",
        success:
          "border-[color:var(--erp-color-success)]/30 bg-[color:var(--erp-color-success)]/10 text-[color:var(--erp-color-success)]",
        warning:
          "border-[color:var(--erp-color-warning)]/30 bg-[color:var(--erp-color-warning)]/10 text-[color:var(--erp-color-warning)]",
        danger:
          "border-[color:var(--erp-color-danger)]/30 bg-[color:var(--erp-color-danger)]/10 text-[color:var(--erp-color-danger)]",
        info:
          "border-[color:var(--erp-color-info)]/30 bg-[color:var(--erp-color-info)]/10 text-[color:var(--erp-color-info)]",
        neutral:
          "border-[color:var(--erp-border-default)] bg-[color:var(--erp-bg-table-header)] text-[color:var(--erp-text-muted)]",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  }
);

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** @deprecated Use `Badge` */
export default Badge;
