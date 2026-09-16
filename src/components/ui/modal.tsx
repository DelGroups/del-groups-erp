"use client";

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogCloseButton,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/cn";

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}

/** Gentelella-styled modal wrapper over Radix Dialog. */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  bodyClassName,
}: ModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex max-h-[min(92dvh,92vh)] min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--erp-radius-md)] border-[color:var(--erp-border-default)] bg-[color:var(--erp-bg-panel)] p-0 shadow-[var(--erp-shadow-lg)]",
          className
        )}
      >
        <DialogHeader className="relative shrink-0 border-b border-[color:var(--erp-border-default)] px-[var(--erp-panel-padding-x)] py-3 pr-10">
          <DialogTitle className="erp-panel-title">{title}</DialogTitle>
          {description ? (
            <DialogDescription className="text-[color:var(--erp-text-muted)]">
              {description}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overscroll-contain px-[var(--erp-panel-padding-x)] py-[var(--erp-panel-padding-y)]",
            bodyClassName
          )}
        >
          {children}
        </div>
        {footer ? (
          <div className="flex shrink-0 justify-end gap-2 border-t border-[color:var(--erp-border-default)] bg-[color:var(--erp-bg-panel)] px-[var(--erp-panel-padding-x)] py-3">
            {footer}
          </div>
        ) : null}
        <DialogCloseButton />
      </DialogContent>
    </Dialog>
  );
}

export default Modal;
