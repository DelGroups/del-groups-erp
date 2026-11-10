"use client";

import React, { useState } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertTriangle, X } from "lucide-react";
import { motionPreset, overlayVariants, panelVariants, transitions } from "../motion";
import { Button } from "./Button";
import { useDesignScope } from "./DesignScope";

/*
 * Dialogs of the UI rulebook (UI-7, docs/ui-standard.md OVL-1, ARIA APG modal dialog), built on
 * Radix: role="dialog", aria-modal, a title, a named close button, a focus trap, Escape closes,
 * focus returns to the opener. The header and the footer stay put; only the body scrolls, and the
 * whole dialog is at most the window height minus 2 rem. On phones every dialog and drawer is a
 * bottom sheet. Texts come from the caller (src/i18n/uiUnifiedLabels.ts).
 */

/** sm 400 px (confirm), md 560 px (short forms, < 5 fields), lg 800 px (longer forms). */
export type DialogSize = "sm" | "md" | "lg";

export interface DialogLabels {
  /** Name of the close (×) button. */
  close: string;
}

interface OverlayShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  labels: DialogLabels;
  /** Buttons, right-aligned: Cancel (secondary) left of the one primary (ACT-3). */
  footer?: React.ReactNode;
  /** While true, Escape, the overlay and × do not close (a save is running). */
  busy?: boolean;
  /** Focus this element first instead of the first focusable one (e.g. the safe button). */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  children?: React.ReactNode;
}

function Surface({ kind, size, open, onOpenChange, title, description, labels, footer, busy, initialFocusRef, children }: OverlayShellProps & { kind: "dialog" | "drawer"; size: DialogSize }) {
  const { portalContainer } = useDesignScope();
  const reduced = useReducedMotion();
  const change = (next: boolean) => {
    if (!next && busy) return;
    onOpenChange(next);
  };
  const motionProps =
    kind === "drawer"
      ? {
          initial: reduced ? { opacity: 0 } : { opacity: 0, x: 24 },
          animate: { opacity: 1, x: 0 },
          exit: reduced ? { opacity: 0 } : { opacity: 0, x: 24 },
          transition: reduced ? transitions.instant : transitions.base,
        }
      : { variants: motionPreset(panelVariants, reduced), initial: "initial", animate: "enter", exit: "exit" };
  return (
    <RadixDialog.Root open={open} onOpenChange={change}>
      <AnimatePresence>
        {open ? (
          <RadixDialog.Portal forceMount container={portalContainer ?? undefined}>
            <RadixDialog.Overlay asChild forceMount>
              <motion.div className="ds-overlay" variants={motionPreset(overlayVariants, reduced)} initial="initial" animate="enter" exit="exit" />
            </RadixDialog.Overlay>
            <RadixDialog.Content
              asChild
              forceMount
              // No description: tell Radix there is none (it links one when it exists).
              {...(description ? {} : { "aria-describedby": undefined })}
              onOpenAutoFocus={(e) => {
                if (initialFocusRef?.current) {
                  e.preventDefault();
                  initialFocusRef.current.focus();
                }
              }}
              onEscapeKeyDown={(e) => {
                if (busy) e.preventDefault();
              }}
              onPointerDownOutside={(e) => {
                if (busy) e.preventDefault();
              }}
            >
              <motion.div className={kind === "drawer" ? "ds-drawer" : "ds-dialog"} data-size={size} {...motionProps}>
                <div className="ds-dialog-header">
                  <div className="min-w-0 flex-1">
                    <RadixDialog.Title className="ds-dialog-title">{title}</RadixDialog.Title>
                    {description ? <RadixDialog.Description className="ds-dialog-description">{description}</RadixDialog.Description> : null}
                  </div>
                  <RadixDialog.Close className="ds-icon-btn" aria-label={labels.close} disabled={busy}>
                    <X className="h-5 w-5" aria-hidden />
                  </RadixDialog.Close>
                </div>
                {children !== undefined ? <div className="ds-dialog-body">{children}</div> : null}
                {footer ? <div className="ds-dialog-footer">{footer}</div> : null}
              </motion.div>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        ) : null}
      </AnimatePresence>
    </RadixDialog.Root>
  );
}

export interface DialogProps extends OverlayShellProps {
  size?: DialogSize;
}

/** A modal dialog (OVL-1). For more than 5 fields, or editing a row next to its list, use Drawer. */
export function Dialog({ size = "md", ...props }: DialogProps) {
  return <Surface kind="dialog" size={size} {...props} />;
}

export type DrawerProps = OverlayShellProps;

/** A side panel from the inline end (480 px) with the same header, body and footer (OVL-1). */
export function Drawer(props: DrawerProps) {
  return <Surface kind="drawer" size="md" {...props} />;
}

export interface ConfirmDialogLabels extends DialogLabels {
  cancel: string;
  /** The confirm button: a verb and the object ("Delete invoice"), never "OK" (ACT-6). */
  confirm: string;
  /** Shown on the confirm button while it runs. */
  working: string;
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Names the object: "Delete invoice INV-0007?" (ACT-5). */
  title: string;
  /** What happens, in one or two sentences. */
  description?: string;
  /** Destructive (danger button and warning icon), the default; false for a neutral question. */
  danger?: boolean;
  labels: ConfirmDialogLabels;
  /** Runs the action; the dialog shows "working" until it settles and closes when it succeeds. */
  onConfirm: () => Promise<void> | void;
}

/**
 * Asks before a consequential action (ACT-5), instead of window.confirm. Focus starts on Cancel,
 * so Enter never confirms by accident; Escape and Cancel close. Irreversible actions that need the
 * name typed use TypeToConfirmDialog.
 */
export function ConfirmDialog({ open, onOpenChange, title, description, danger = true, labels, onConfirm }: ConfirmDialogProps) {
  const [working, setWorking] = useState(false);
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const run = async () => {
    if (working) return;
    setWorking(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setWorking(false);
    }
  };
  return (
    <Surface
      kind="dialog"
      size="sm"
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      labels={labels}
      busy={working}
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} onClick={() => onOpenChange(false)} disabled={working}>
            {labels.cancel}
          </Button>
          <Button variant={danger ? "danger" : "primary"} loading={working} onClick={() => void run()}>
            {working ? labels.working : labels.confirm}
          </Button>
        </>
      }
    >
      {description ? (
        <div className="flex gap-3">
          {danger ? (
            <span className="ds-dialog-warning" aria-hidden>
              <AlertTriangle className="h-5 w-5" />
            </span>
          ) : null}
          <p className="ds-muted">{description}</p>
        </div>
      ) : undefined}
    </Surface>
  );
}
