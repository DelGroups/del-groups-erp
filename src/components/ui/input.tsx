"use client";

import React from "react";
import { cn } from "@/lib/cn";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const FIELD_CLASS =
  "h-9 w-full rounded-lg border border-slate-200 bg-app-card px-3 text-sm text-app placeholder:text-app-muted focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/15";

export default function Input({ className, ...props }: InputProps) {
  return <input className={cn(FIELD_CLASS, className)} {...props} />;
}
