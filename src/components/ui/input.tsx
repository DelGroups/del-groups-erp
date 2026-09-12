"use client";

import React from "react";
import { cn } from "@/lib/cn";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

import { formControlClass } from "@/components/ui/form-field-styles";

export const FIELD_CLASS = formControlClass;

export default function Input({ className, ...props }: InputProps) {
  return <input className={cn(FIELD_CLASS, className)} {...props} />;
}
