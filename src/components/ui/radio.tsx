"use client";

import React from "react";
import { cn } from "@/lib/cn";

export interface RadioProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: React.ReactNode;
}

export function Radio({ className, label, id, ...props }: RadioProps) {
  const inputId = id ?? (typeof label === "string" ? `radio-${label}` : undefined);

  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[length:var(--erp-text-sm)] text-[color:var(--erp-text-main)]">
      <input
        id={inputId}
        type="radio"
        className={cn(
          "h-4 w-4 border border-[color:var(--erp-border-default)] text-[color:var(--erp-color-primary)] focus:ring-2 focus:ring-[color:var(--erp-border-focus)] disabled:opacity-50",
          className
        )}
        {...props}
      />
      {label ? <span>{label}</span> : null}
    </label>
  );
}

export default Radio;
