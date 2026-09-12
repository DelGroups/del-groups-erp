"use client";

import React from "react";
import { cn } from "@/lib/cn";
import { formFieldClass, formLabelClass } from "@/components/ui/form-field-styles";

export interface FormFieldProps {
  label?: React.ReactNode;
  required?: boolean;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export function FormField({
  label,
  required,
  hint,
  error,
  className,
  children,
}: FormFieldProps) {
  return (
    <div className={cn(formFieldClass, className)}>
      {label ? (
        <label className={formLabelClass}>
          {label}
          {required ? <span className="text-rose-600"> *</span> : null}
        </label>
      ) : null}
      {children}
      {hint ? (
        <p className="mt-1 text-xs font-normal text-slate-600 dark:text-app-muted">{hint}</p>
      ) : null}
      {error ? <p className="mt-1 text-xs font-medium text-rose-600">{error}</p> : null}
    </div>
  );
}
