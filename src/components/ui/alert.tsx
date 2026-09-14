"use client";

import React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

export const alertVariants = cva(
  "rounded-[var(--erp-radius-md)] border px-4 py-3 text-[length:var(--erp-text-sm)]",
  {
    variants: {
      variant: {
        info:
          "border-[color:var(--erp-color-info)]/30 bg-[color:var(--erp-color-info)]/10 text-[color:var(--erp-text-main)]",
        success:
          "border-[color:var(--erp-color-success)]/30 bg-[color:var(--erp-color-success)]/10 text-[color:var(--erp-text-main)]",
        warning:
          "border-[color:var(--erp-color-warning)]/30 bg-[color:var(--erp-color-warning)]/10 text-[color:var(--erp-text-main)]",
        danger:
          "border-[color:var(--erp-color-danger)]/30 bg-[color:var(--erp-color-danger)]/10 text-[color:var(--erp-text-main)]",
      },
    },
    defaultVariants: {
      variant: "info",
    },
  }
);

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {
  title?: string;
}

export function Alert({ className, variant, title, children, ...props }: AlertProps) {
  return (
    <div className={cn(alertVariants({ variant }), className)} role="alert" {...props}>
      {title ? <p className="mb-1 font-[var(--erp-font-weight-semibold)]">{title}</p> : null}
      <div>{children}</div>
    </div>
  );
}

export default Alert;
