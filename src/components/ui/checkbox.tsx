"use client";

import React from "react";
import { cn } from "@/lib/cn";

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: React.ReactNode;
}

export function Checkbox({ className, label, id, ...props }: CheckboxProps) {
  const inputId = id ?? (typeof label === "string" ? `checkbox-${label}` : undefined);

  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[length:var(--erp-text-sm)] text-[color:var(--erp-text-main)]">
      <input
        id={inputId}
        type="checkbox"
        className={cn(
          "h-4 w-4 rounded-[var(--erp-radius-sm)] border border-[color:var(--erp-border-default)] text-[color:var(--erp-color-primary)] focus:ring-2 focus:ring-[color:var(--erp-border-focus)] disabled:opacity-50",
          className
        )}
        {...props}
      />
      {label ? <span>{label}</span> : null}
    </label>
  );
}

export default Checkbox;
