"use client";

import React from "react";
import { cn } from "@/lib/cn";
import { formErrorClass, formFieldClass, formHintClass, formLabelClass } from "@/components/ui/form-field-styles";

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
          {required ? <span className="text-[color:var(--erp-color-danger)]"> *</span> : null}
        </label>
      ) : null}
      {children}
      {hint ? <p className={formHintClass}>{hint}</p> : null}
      {error ? <p className={formErrorClass} role="alert">{error}</p> : null}
    </div>
  );
}
