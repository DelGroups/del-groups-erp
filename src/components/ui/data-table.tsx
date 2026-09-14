"use client";

import React from "react";
import { cn } from "@/lib/cn";

export interface DataTableColumn<T> {
  header: string;
  accessor: keyof T | ((item: T) => React.ReactNode);
  align?: "left" | "center" | "right";
  className?: string;
  headerClassName?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  className?: string;
  emptyMessage?: string;
  striped?: boolean;
  getRowKey?: (item: T, index: number) => string | number;
}

function resolveCell<T>(item: T, accessor: DataTableColumn<T>["accessor"]): React.ReactNode {
  if (typeof accessor === "function") return accessor(item);
  const value = item[accessor];
  if (value === null || value === undefined) return "";
  return String(value);
}

const alignClass = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
} as const;

export function DataTable<T extends { id?: string | number }>({
  columns,
  data,
  className,
  emptyMessage,
  striped = true,
  getRowKey,
}: DataTableProps<T>) {
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="w-full border-collapse text-[length:var(--erp-text-sm)] text-[color:var(--erp-text-muted)]">
        <thead>
          <tr className="border-b-2 border-[color:var(--erp-border-default)] bg-[color:var(--erp-bg-table-header)]">
            {columns.map((col, index) => (
              <th
                key={`${col.header}-${index}`}
                className={cn(
                  "px-2 py-3 text-[length:var(--erp-text-sm)] font-[var(--erp-font-weight-semibold)] text-[color:var(--erp-text-main)]",
                  alignClass[col.align ?? "left"],
                  col.headerClassName
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-2 py-6 text-center text-[color:var(--erp-text-muted)]"
              >
                {emptyMessage ?? "—"}
              </td>
            </tr>
          ) : (
            data.map((row, rowIndex) => (
              <tr
                key={getRowKey?.(row, rowIndex) ?? row.id ?? rowIndex}
                className={cn(
                  "border-b border-[color:var(--erp-border-default)] transition-colors hover:bg-[color:var(--erp-bg-main)]",
                  striped && rowIndex % 2 === 1 && "bg-[color:var(--erp-bg-table-row-alt)]"
                )}
              >
                {columns.map((col, colIndex) => (
                  <td
                    key={`${col.header}-${colIndex}`}
                    className={cn(
                      "px-2 py-2.5 text-[length:var(--erp-text-sm)] text-[color:var(--erp-text-main)]",
                      alignClass[col.align ?? "left"],
                      col.className
                    )}
                  >
                    {resolveCell(row, col.accessor)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default DataTable;
