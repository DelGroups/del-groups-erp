"use client";

import React from "react";
import { cn } from "@/lib/cn";
import { formSelectClass } from "@/components/ui/form-field-styles";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export default function Select({ className, children, ...props }: SelectProps) {
  return (
    <select className={cn(formSelectClass, className)} {...props}>
      {children}
    </select>
  );
}
