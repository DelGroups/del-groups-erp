"use client";

import React from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn, NUMERIC_CLASS } from "@/lib/cn";
import { useI18n } from "@/i18n/I18nProvider";
import { Skeleton } from "@/components/ui/skeleton";

const COMPACT_CELL = "px-2.5 py-1.5 text-sm";
const COMPACT_HEAD = "px-2.5 py-1.5 text-xs font-bold uppercase tracking-wide";

export function TableWrap({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("app-table-wrap w-full overflow-x-auto", className)}>{children}</div>;
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn("app-table w-full min-w-full text-left text-sm", className)}
      {...props}
    />
  );
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        "border-b border-app bg-[color:var(--app-table-header)] text-slate-700 dark:text-app",
        className
      )}
      {...props}
    />
  );
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y divide-app", className)} {...props} />;
}

export function Tr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn("transition-colors hover:bg-app-card-hover", className)}
      {...props}
    />
  );
}

export function Th({
  className,
  numeric,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return <th className={cn(COMPACT_HEAD, numeric && NUMERIC_CLASS, className)} {...props} />;
}

export function Td({
  className,
  numeric,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return <td className={cn(COMPACT_CELL, numeric && NUMERIC_CLASS, className)} {...props} />;
}

/** Narrow actions column for kebab menus. */
export function ActionsTh({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <Th
      className={cn("w-12 whitespace-nowrap text-center", className)}
      {...props}
    />
  );
}

export function ActionsTd({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <Td className={cn("w-12 whitespace-nowrap text-center", className)} {...props} />
  );
}

/** Checkbox column for bulk row selection. */
export function SelectTh({
  checked,
  indeterminate,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  className?: string;
  "aria-label"?: string;
}) {
  const { t } = useI18n();
  const ref = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);

  return (
    <Th className={cn("w-10 px-2 text-center", className)}>
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={ariaLabel ?? t("table.selectAll")}
        className="h-3.5 w-3.5 rounded border-app text-app-accent focus:ring-app-accent/30"
      />
    </Th>
  );
}

export function SelectTd({
  checked,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange: () => void;
  className?: string;
  "aria-label"?: string;
}) {
  const { t } = useI18n();

  return (
    <Td className={cn("w-10 px-2 text-center", className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={ariaLabel ?? t("table.selectRow")}
        className="h-3.5 w-3.5 rounded border-app text-app-accent focus:ring-app-accent/30"
      />
    </Td>
  );
}

export function TableSkeletonRows({
  columns,
  rows = 8,
  withActions = true,
}: {
  columns: number;
  rows?: number;
  withActions?: boolean;
}) {
  const totalColumns = columns + (withActions ? 1 : 0);

  return (
    <>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <Tr key={rowIndex}>
          {Array.from({ length: totalColumns }).map((__, colIndex) => (
            <Td key={colIndex}>
              <Skeleton
                className={cn(
                  "h-3.5",
                  colIndex === 0 ? "w-4" : colIndex === totalColumns - 1 ? "mx-auto h-6 w-6" : "w-full max-w-[8rem]"
                )}
              />
            </Td>
          ))}
        </Tr>
      ))}
    </>
  );
}

export interface BulkActionBarProps {
  count: number;
  onClear: () => void;
  children?: React.ReactNode;
  className?: string;
}

export function BulkActionBar({ count, onClear, children, className }: BulkActionBarProps) {
  const { t } = useI18n();

  if (count <= 0) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 border-b border-app bg-[color:var(--app-accent-soft)] px-2.5 py-2 text-xs",
        className
      )}
    >
      <span className="font-semibold text-app">
        {t("table.selectedCount", { count })}
      </span>
      <button
        type="button"
        onClick={onClear}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-app-muted transition-colors hover:bg-app-card-hover hover:text-app"
      >
        <X className="h-3.5 w-3.5" />
        {t("table.clearSelection")}
      </button>
      {children ? <div className="ms-auto flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

export interface TablePaginationProps {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
  onLimitChange?: (limit: number) => void;
  limitOptions?: number[];
  className?: string;
}

export function TablePagination({
  page,
  limit,
  total,
  onPageChange,
  onLimitChange,
  limitOptions = [10, 25, 50, 100],
  className,
}: TablePaginationProps) {
  const { t } = useI18n();
  const totalPages = Math.max(1, Math.ceil(total / limit) || 1);
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = total === 0 ? 0 : (safePage - 1) * limit + 1;
  const end = total === 0 ? 0 : Math.min(safePage * limit, total);

  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-t border-app bg-app-card px-2.5 py-2 text-sm text-slate-700 dark:text-app-muted sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      <p>
        {t("table.paginationSummary", { start, end, total })}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {onLimitChange ? (
          <label className="inline-flex items-center gap-1.5 text-xs font-medium">
            <span>{t("table.rowsPerPage")}</span>
            <select
              value={limit}
              onChange={(event) => onLimitChange(Number(event.target.value))}
              className="app-input h-8 w-auto py-0 text-xs"
            >
              {limitOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => onPageChange(safePage - 1)}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-app bg-app-card px-2 text-xs font-semibold text-app transition-colors hover:bg-app-card-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {t("table.prevPage")}
          </button>
          <span className="px-2 text-xs font-medium tabular-nums">
            {t("table.pageOf", { page: safePage, totalPages })}
          </span>
          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => onPageChange(safePage + 1)}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-app bg-app-card px-2 text-xs font-semibold text-app transition-colors hover:bg-app-card-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("table.nextPage")}
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export interface DataTableProps {
  children: React.ReactNode;
  pagination?: TablePaginationProps;
  className?: string;
}

/** Table shell with optional server-side pagination footer. */
export function DataTable({ children, pagination, className }: DataTableProps) {
  return (
    <div className={cn("flex w-full flex-col overflow-hidden rounded-xl border border-app bg-app-card", className)}>
      <TableWrap className="rounded-none border-0 shadow-none">{children}</TableWrap>
      {pagination ? <TablePagination {...pagination} /> : null}
    </div>
  );
}
