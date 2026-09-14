"use client";

import React from "react";
import { cn } from "@/lib/cn";

export const cardShellClass =
  "rounded-lg border border-slate-200 bg-white text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** When true (default), applies standard inner padding for legacy simple cards. */
  padding?: boolean;
}

export function Card({ className, padding = true, children, ...props }: CardProps) {
  return (
    <div className={cn(cardShellClass, padding && "p-5", className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-col gap-1.5 border-b border-slate-200 p-6 pb-4 dark:border-slate-700", className)} {...props} />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("text-base font-semibold leading-none tracking-tight text-slate-900 dark:text-slate-100", className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center border-t border-slate-200 p-6 pt-4 dark:border-slate-700", className)}
      {...props}
    />
  );
}

/** @deprecated Use CardTitle with CardMeta-style classes or a subtitle in CardHeader. */
export function CardMeta({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400", className)}
      {...props}
    />
  );
}

export default Card;
