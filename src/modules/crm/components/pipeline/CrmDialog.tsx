"use client";

import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { useDesignScope } from "@/design-system/components";
import { motionPreset, overlayVariants, panelVariants } from "@/design-system/motion";

export interface CrmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  closeLabel: string;
  submitLabel: string;
  cancelLabel: string;
  busy?: boolean;
  /** The submit button stays disabled while false. */
  canSubmit?: boolean;
  danger?: boolean;
  onSubmit: () => void | Promise<void>;
  children: React.ReactNode;
}

/** A small form in a dialog (quick create, lost reason, convert): Radix dialog with the design-system panel. */
export function CrmDialog({ open, onOpenChange, title, description, closeLabel, submitLabel, cancelLabel, busy, canSubmit = true, danger, onSubmit, children }: CrmDialogProps) {
  const { portalContainer } = useDesignScope();
  const reduced = useReducedMotion();
  return (
    <Dialog.Root open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <Dialog.Portal container={portalContainer ?? undefined}>
        <Dialog.Overlay asChild>
          <motion.div className="ds-overlay" variants={motionPreset(overlayVariants, reduced)} initial="initial" animate="enter" />
        </Dialog.Overlay>
        <Dialog.Content asChild>
          <motion.div
            className="ds-panel fixed left-1/2 top-1/2 z-[61] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-6"
            variants={motionPreset(panelVariants, reduced)}
            initial="initial"
            animate="enter"
          >
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!busy && canSubmit) void onSubmit();
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Dialog.Title className="text-[length:var(--ds-text-lg)] font-semibold">{title}</Dialog.Title>
                  {description ? <Dialog.Description className="mt-1 ds-muted">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
                </div>
                <Dialog.Close asChild>
                  <button type="button" className="ds-btn ds-btn-ghost ds-btn-sm" aria-label={closeLabel} disabled={busy}>
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </Dialog.Close>
              </div>
              {children}
              <div className="flex justify-end gap-2">
                <Dialog.Close asChild>
                  <button type="button" className="ds-btn" disabled={busy}>
                    {cancelLabel}
                  </button>
                </Dialog.Close>
                <button type="submit" className={`ds-btn ${danger ? "ds-btn-danger" : "ds-btn-primary"}`} disabled={busy || !canSubmit} aria-busy={busy || undefined}>
                  {submitLabel}
                </button>
              </div>
            </form>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A labelled input row of a dialog form. */
export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="ds-label">{label}</span>
      {children}
      {hint ? <span className="text-[length:var(--ds-text-xs)] ds-subtle">{hint}</span> : null}
    </label>
  );
}
