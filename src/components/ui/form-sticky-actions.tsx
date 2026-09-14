"use client";

import React from "react";
import { cn } from "@/lib/cn";

/** Fixed action bar pinned to the bottom of the viewport for enterprise forms. */
export function FormStickyActions({
  children,
  className,
  fullWidth = false,
}: {
  children: React.ReactNode;
  className?: string;
  /** Match fluid page layouts (no max-w-7xl cap). */
  fullWidth?: boolean;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-0 z-30",
        className
      )}
    >
      <div
        className={cn(
          "pointer-events-auto mx-auto flex w-full items-center justify-end gap-2 border-t border-app bg-app-card/95 px-4 py-3 shadow-[0_-4px_24px_rgba(15,23,42,0.08)] backdrop-blur-md dark:shadow-[0_-4px_24px_rgba(0,0,0,0.35)] sm:gap-3 sm:px-6",
          fullWidth ? "max-w-none" : "max-w-7xl"
        )}
      >
        {children}
      </div>
    </div>
  );
}
