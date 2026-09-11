"use client";

import React from "react";
import { cn } from "@/lib/cn";

export type StatusTone = "draft" | "posted" | "cancelled" | "low-stock" | "success" | "warning" | "neutral";

const TONE: Record<StatusTone, string> = {
  draft: "border-amber-200 bg-amber-100 text-amber-800",
  posted: "border-emerald-200 bg-emerald-100 text-emerald-800",
  cancelled: "border-rose-200 bg-rose-100 text-rose-700",
  "low-stock": "border-orange-200 bg-orange-100 text-orange-800",
  success: "border-emerald-200 bg-emerald-100 text-emerald-800",
  warning: "border-amber-200 bg-amber-100 text-amber-800",
  neutral: "border-app bg-app-card-hover text-app",
};

interface StatusBadgeProps {
  tone?: StatusTone;
  children: React.ReactNode;
  className?: string;
}

export default function StatusBadge({ tone = "neutral", children, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide",
        TONE[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
