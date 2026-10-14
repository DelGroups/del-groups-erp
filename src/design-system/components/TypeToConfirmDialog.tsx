"use client";

import React, { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, useReducedMotion } from "motion/react";
import { AlertTriangle, Copy } from "lucide-react";
import { confirmState } from "../logic";
import { motionPreset, overlayVariants, panelVariants } from "../motion";
import { useDesignScope } from "./DesignScope";

export interface TypeToConfirmLabels {
  title: string;
  description: string;
  /** "Type {name} to confirm" with the name shown separately. */
  instruction: string;
  copy: string;
  cancel: string;
  confirm: string;
  working: string;
  audit: string;
}

export interface TypeToConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What must be typed exactly, e.g. the record's name. */
  confirmText: string;
  /** What disappears with it, one line each. */
  consequences?: readonly string[];
  labels: TypeToConfirmLabels;
  /** Runs the deletion; the dialog shows "working" until it settles and closes on success. */
  onConfirm: () => Promise<void> | void;
}

/**
 * Destructive confirmation (reference bonus/bonus-type-to-confirm-delete-dialog): the red
 * button stays disabled until the name is typed exactly; the input turns red once the typing
 * no longer leads to the name; Enter confirms on a match; Esc, Cancel or a click outside close.
 */
export function TypeToConfirmDialog({ open, onOpenChange, confirmText, consequences = [], labels, onConfirm }: TypeToConfirmDialogProps) {
  const { portalContainer } = useDesignScope();
  const reduced = useReducedMotion();
  const [typed, setTyped] = useState("");
  const [working, setWorking] = useState(false);
  const state = confirmState(typed, confirmText);

  const close = (next: boolean) => {
    if (working) return;
    if (!next) setTyped("");
    onOpenChange(next);
  };

  const submit = async () => {
    if (state !== "match" || working) return;
    setWorking(true);
    try {
      await onConfirm();
      setTyped("");
      onOpenChange(false);
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={close}>
      <Dialog.Portal container={portalContainer ?? undefined}>
        <Dialog.Overlay asChild>
          <motion.div className="ds-overlay" variants={motionPreset(overlayVariants, reduced)} initial="initial" animate="enter" />
        </Dialog.Overlay>
        <Dialog.Content asChild>
          <motion.div
            className="ds-panel fixed left-1/2 top-1/2 z-[61] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 p-6"
            variants={motionPreset(panelVariants, reduced)}
            initial="initial"
            animate="enter"
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
              className="flex flex-col gap-4"
            >
              <div className="flex gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--ds-radius-md)]" style={{ background: "var(--ds-danger-soft)", color: "var(--ds-danger-strong)" }} aria-hidden>
                  <AlertTriangle className="h-5 w-5" />
                </span>
                <div>
                  <Dialog.Title className="text-[length:var(--ds-text-lg)] font-semibold">{labels.title}</Dialog.Title>
                  <Dialog.Description className="mt-1 ds-muted">{labels.description}</Dialog.Description>
                </div>
              </div>

              {consequences.length ? (
                <ul className="flex flex-col gap-1.5 p-3" style={{ border: "1px solid var(--ds-border)", borderRadius: "var(--ds-radius-md)" }}>
                  {consequences.map((c) => (
                    <li key={c} className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--ds-danger-strong)" }} aria-hidden />
                      {c}
                    </li>
                  ))}
                </ul>
              ) : null}

              <label className="flex flex-col gap-2">
                <span className="flex flex-wrap items-center gap-2">
                  {labels.instruction}
                  <code className="ds-mono rounded-[var(--ds-radius-xs)] px-1.5 py-0.5" style={{ background: "var(--ds-surface-sunken)" }}>
                    {confirmText}
                  </code>
                  <button
                    type="button"
                    className="ds-btn ds-btn-ghost ds-btn-sm"
                    aria-label={labels.copy}
                    onClick={() => void navigator.clipboard?.writeText(confirmText).catch(() => undefined)}
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </span>
                <input
                  className="ds-input ds-mono"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={state === "diverged" ? true : undefined}
                  disabled={working}
                />
              </label>

              <div className="flex justify-end gap-2">
                <Dialog.Close asChild>
                  <button type="button" className="ds-btn" disabled={working}>
                    {labels.cancel}
                  </button>
                </Dialog.Close>
                <button type="submit" className="ds-btn ds-btn-danger" disabled={state !== "match" || working} aria-busy={working || undefined}>
                  {working ? labels.working : labels.confirm}
                </button>
              </div>
              <p className="text-[length:var(--ds-text-xs)] ds-subtle">{labels.audit}</p>
            </form>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
