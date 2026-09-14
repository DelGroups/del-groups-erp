"use client";

import React from "react";
import { cn } from "@/lib/cn";
import { formErrorClass } from "@/components/ui/form-field-styles";

export function ErrorMessage({ className, children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  if (!children) return null;
  return (
    <p className={cn(formErrorClass, className)} role="alert" {...props}>
      {children}
    </p>
  );
}

export default ErrorMessage;
