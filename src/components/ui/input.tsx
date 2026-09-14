"use client";

import React from "react";
import { cn } from "@/lib/cn";
import { formControlClass, formControlErrorClass } from "@/components/ui/form-field-styles";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const FIELD_CLASS = formControlClass;

export default function Input({ className, error, ...props }: InputProps) {
  return (
    <input
      className={cn(FIELD_CLASS, error && formControlErrorClass, className)}
      aria-invalid={error || undefined}
      {...props}
    />
  );
}
