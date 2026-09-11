"use client";

import React from "react";
import { cn } from "@/lib/cn";
import { FIELD_CLASS } from "@/components/ui/input";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export default function Select({ className, children, ...props }: SelectProps) {
  return (
    <select
      className={cn(
        FIELD_CLASS,
        "[&>option]:bg-white [&>option]:font-medium [&>option]:text-slate-900",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}
