"use client";

import React from "react";
import { cn, NUMERIC_CLASS } from "@/lib/cn";

export function TableWrap({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("app-table-wrap overflow-hidden", className)}>{children}</div>;
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("app-table w-full text-left text-xs", className)} {...props} />;
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn("border-b border-app bg-app-card-hover text-xs font-bold uppercase text-app", className)}
      {...props}
    />
  );
}

export function Th({ className, numeric, ...props }: React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th className={cn("px-4 py-3", numeric && NUMERIC_CLASS, className)} {...props} />
  );
}

export function Td({ className, numeric, ...props }: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td className={cn("px-4 py-3", numeric && NUMERIC_CLASS, className)} {...props} />
  );
}
