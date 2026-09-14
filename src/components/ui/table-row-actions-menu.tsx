"use client";

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

const MENU_MIN_WIDTH = 176;

function useFloatingMenuPosition(
  open: boolean,
  triggerRef: React.RefObject<HTMLButtonElement | null>,
  align: "left" | "right"
) {
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });

  const update = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 8;
    let left = align === "right" ? rect.right - MENU_MIN_WIDTH : rect.left;
    left = Math.max(
      viewportPadding,
      Math.min(left, window.innerWidth - MENU_MIN_WIDTH - viewportPadding)
    );

    const top = rect.bottom + 4;
    const maxTop = window.innerHeight - viewportPadding;
    const resolvedTop = top > maxTop ? Math.max(viewportPadding, rect.top - 4) : top;

    setStyle({
      position: "fixed",
      top: resolvedTop,
      left,
      minWidth: MENU_MIN_WIDTH,
      zIndex: 10050,
      visibility: "visible",
    });
  }, [align, triggerRef]);

  useLayoutEffect(() => {
    if (!open) return;
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, update]);

  return style;
}

export function TableRowActionsMenu({
  items,
  align = "right",
  className,
  menuLabel,
}: TableRowActionsMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const menuStyle = useFloatingMenuPosition(open, triggerRef, align);

  const visibleItems = items.filter((item) => !item.hidden);
  const primaryItems = visibleItems.filter((item) => item.variant !== "destructive");
  const destructiveItems = visibleItems.filter((item) => item.variant === "destructive");

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
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

  const menu = open && mounted ? (
    <div
      id={menuId}
      ref={menuRef}
      role="menu"
      style={menuStyle}
      className="overflow-hidden rounded-lg border border-[color:var(--gt-border-color)] bg-[color:var(--gt-panel-bg)] py-1 shadow-lg"
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
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-[color:var(--gt-text-dark)] transition-colors hover:bg-[color:var(--gt-bg-main)] disabled:cursor-not-allowed disabled:opacity-40"
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
  ) : null;

  return (
    <div ref={rootRef} className={cn("relative inline-flex justify-end", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title={resolvedMenuLabel}
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[color:var(--gt-border-color)] bg-[color:var(--gt-panel-bg)] text-[color:var(--gt-text-primary)] transition-colors hover:bg-[color:var(--gt-bg-main)] hover:text-[color:var(--gt-text-dark)]"
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}
