"use client";

import React, { useEffect, useId, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/I18nProvider";

function useDrawerSide(): "left" | "right" {
  const [side, setSide] = useState<"left" | "right">("right");

  useEffect(() => {
    const resolve = () => {
      const dir =
        document.documentElement.getAttribute("dir") ||
        document.body.getAttribute("dir") ||
        "ltr";
      setSide(dir === "rtl" ? "left" : "right");
    };

    resolve();
    const observer = new MutationObserver(resolve);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["dir"],
    });
    return () => observer.disconnect();
  }, []);

  return side;
}

function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;

    const originalOverflow = document.body.style.overflow;
    const originalPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.paddingRight = originalPaddingRight;
    };
  }, [locked]);
}

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  closeLabel?: string;
}

/** Slide-out panel for complex forms. Header and footer stay fixed; body scrolls. */
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  className,
  closeLabel,
}: DrawerProps) {
  const { t } = useI18n();
  const side = useDrawerSide();
  const titleId = useId();
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const resolvedCloseLabel = closeLabel ?? t("common.close");

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        aria-label={resolvedCloseLabel}
        className="absolute inset-0 bg-[color:var(--app-overlay)] backdrop-blur-sm app-drawer-backdrop"
        onClick={onClose}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "app-drawer-panel fixed inset-y-0 flex h-full w-full flex-col border-app bg-app-card shadow-2xl",
          "sm:w-[45vw] sm:min-w-[20rem] sm:max-w-[50vw]",
          side === "right" ? "end-0 border-s" : "start-0 border-e",
          side === "right" ? "app-drawer-panel-right" : "app-drawer-panel-left",
          className
        )}
      >
        <header
          className="flex shrink-0 items-center justify-between gap-3 border-b border-app bg-app-glass px-4 py-3 backdrop-blur-md"
        >
          <h2 id={titleId} className="text-base font-bold text-app">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={resolvedCloseLabel}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-app-muted transition-colors hover:bg-app-card-hover hover:text-app"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          {children}
        </div>

        {footer ? (
          <footer className="shrink-0 border-t border-app bg-app-glass px-4 py-3 backdrop-blur-md">
            {footer}
          </footer>
        ) : null}
      </aside>
    </div>
  );
}

export interface DrawerFooterProps {
  onCancel: () => void;
  cancelLabel?: string;
  submitLabel?: string;
  submitDisabled?: boolean;
  /** Links the submit button to a form rendered in the drawer body. */
  formId?: string;
  onSubmit?: () => void;
}

export function DrawerFooter({
  onCancel,
  cancelLabel,
  submitLabel,
  submitDisabled,
  formId,
  onSubmit,
}: DrawerFooterProps) {
  const { t } = useI18n();

  return (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg border border-app px-4 py-2 text-xs font-semibold text-app transition-colors hover:bg-app-card-hover"
      >
        {cancelLabel ?? t("common.cancel")}
      </button>
      <button
        type={formId ? "submit" : "button"}
        form={formId}
        disabled={submitDisabled}
        onClick={formId ? undefined : onSubmit}
        className="btn-primary disabled:opacity-50"
      >
        {submitLabel ?? t("common.save")}
      </button>
    </div>
  );
}
