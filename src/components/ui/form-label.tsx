"use client";

import React from "react";
import { cn } from "@/lib/cn";
import { formLabelClass } from "@/components/ui/form-field-styles";

export interface FormLabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

export function FormLabel({ className, children, required, ...props }: FormLabelProps) {
  return (
    <label className={cn(formLabelClass, className)} {...props}>
      {children}
      {required ? <span className="text-[color:var(--erp-color-danger)]"> *</span> : null}
    </label>
  );
}

export default FormLabel;
