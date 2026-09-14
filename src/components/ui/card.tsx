"use client";

import React from "react";
import { cn } from "@/lib/cn";

/** Elevated panel surface — use `Panel` for standard Gentelella sections. */
export const cardShellClass =
  "rounded-[var(--erp-radius-md)] border border-[color:var(--erp-border-default)] bg-[color:var(--erp-bg-panel)] text-[color:var(--erp-text-main)] shadow-[var(--erp-shadow-sm)]";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padding?: boolean;
}

export function Card({ className, padding = true, children, ...props }: CardProps) {
  return (
    <div
      className={cn(cardShellClass, padding && "p-[var(--erp-space-5)]", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 border-b border-[color:var(--erp-border-default)] px-[var(--erp-panel-padding-x)] pb-4 pt-5",
        className
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("erp-panel-title", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-[var(--erp-space-5)] pt-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center border-t border-[color:var(--erp-border-default)] px-[var(--erp-panel-padding-x)] pb-5 pt-4",
        className
      )}
      {...props}
    />
  );
}

export function CardMeta({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("erp-small", className)} {...props} />;
}

export default Card;
