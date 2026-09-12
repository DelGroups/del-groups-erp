"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { MoreVertical } from "lucide-react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/I18nProvider";

export type TableRowActionVariant = "default" | "destructive";

export interface TableRowActionItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  hidden?: boolean;
  variant?: TableRowActionVariant;
}

interface TableRowActionsMenuProps {
  items: TableRowActionItem[];
  align?: "left" | "right";
  className?: string;
  /** Accessible label for the kebab trigger. */
  menuLabel?: string;
}

export function TableRowActionsMenu({
  items,
  align = "right",
  className,
  menuLabel,
}: TableRowActionsMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const visibleItems = items.filter((item) => !item.hidden);
  const primaryItems = visibleItems.filter((item) => item.variant !== "destructive");
  const destructiveItems = visibleItems.filter((item) => item.variant === "destructive");

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  if (visibleItems.length === 0) return null;

  const resolvedMenuLabel = menuLabel ?? t("common.actions");

  return (
    <div ref={rootRef} className={cn("relative inline-flex justify-end", className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title={resolvedMenuLabel}
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-app bg-app-card text-app-muted transition-colors hover:bg-app-card-hover hover:text-app"
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          className={cn(
            "absolute z-40 mt-1 min-w-[11rem] overflow-hidden rounded-lg border border-app bg-app-card py-1 shadow-lg",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          {primaryItems.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                item.onClick();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-app transition-colors hover:bg-app-card-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {item.icon ? <span className="shrink-0 text-app-muted">{item.icon}</span> : null}
              <span className="truncate">{item.label}</span>
            </button>
          ))}

          {primaryItems.length > 0 && destructiveItems.length > 0 ? (
            <div className="my-1 border-t border-app" role="separator" />
          ) : null}

          {destructiveItems.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                item.onClick();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-500/10"
            >
              {item.icon ? <span className="shrink-0">{item.icon}</span> : null}
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
