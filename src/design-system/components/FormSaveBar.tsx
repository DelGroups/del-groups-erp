"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Save, Undo2 } from "lucide-react";
import { leaveTarget } from "../logic";
import { transitions } from "../motion";
import { Button } from "./Button";
import { ConfirmDialog } from "./Dialog";

export interface FormSaveBarLabels {
  /** "Unsaved changes": the bar's text and region name. */
  unsaved: string;
  discard: string;
  save: string;
  saving: string;
}

export interface FormSaveBarProps {
  /** Something differs from the saved values; the bar shows only then (or while saving). */
  dirty: boolean;
  saving: boolean;
  /** Save is not possible yet (an invalid field); the reason is shown at the field (FORM-3). */
  disabled?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  labels: FormSaveBarLabels;
  /** Show the bar all the time (a new record), not only while dirty. */
  alwaysVisible?: boolean;
}

/**
 * The one save bar of a form (FORM-5, ACT-3): sticks to the bottom of the page scroller and shows
 * while something changed; Discard (ghost) left of Save (primary), Save rightmost. It is the only
 * place a form's Save lives, so there is never a second Save at the top of the form.
 */
export function FormSaveBar({ dirty, saving, disabled, onSave, onDiscard, labels, alwaysVisible = false }: FormSaveBarProps) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {alwaysVisible || dirty || saving ? (
        <motion.div
          key="savebar"
          className="erp-sticky-actions ds-savebar"
          role="region"
          aria-label={labels.unsaved}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
          transition={reduced ? transitions.instant : transitions.base}
        >
          <div className="ds-savebar-inner">
            {dirty ? <span className="ds-dot ds-savebar-dot" aria-hidden /> : null}
            <p className="min-w-0 flex-1 truncate font-medium" aria-live="polite">
              {dirty ? labels.unsaved : ""}
            </p>
            <Button variant="ghost" icon={Undo2} onClick={onDiscard} disabled={saving || !dirty}>
              <span className="ds-hide-compact">{labels.discard}</span>
            </Button>
            <Button variant="primary" icon={Save} loading={saving} onClick={onSave} disabled={disabled || (!dirty && !alwaysVisible)}>
              {saving ? labels.saving : labels.save}
            </Button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export interface LeaveDialogLabels {
  title: string;
  body: string;
  stay: string;
  leave: string;
  close: string;
}

/**
 * "Unsaved changes" guard while `dirty` (FORM-5): closing or reloading the tab asks the browser's
 * own question; a link inside the app (menu, crumbs, shell) opens our dialog first, with Stay
 * focused. Returns the dialog, which the page renders.
 */
export function useUnsavedChangesGuard(dirty: boolean, labels: LeaveDialogLabels): React.ReactNode {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    // Capture phase on the document: runs before React's own click handling (next/link).
    const onClick = (event: MouseEvent) => {
      if (!dirtyRef.current) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      const href = leaveTarget(
        anchor ? { href: anchor.href, target: anchor.target, download: anchor.hasAttribute("download") } : null,
        { button: event.button, modified: event.metaKey || event.ctrlKey || event.shiftKey || event.altKey, defaultPrevented: event.defaultPrevented },
        window.location
      );
      if (!href) return;
      event.preventDefault();
      event.stopPropagation();
      setPending(href);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  const leave = useCallback(() => {
    const href = pending;
    setPending(null);
    if (!href) return;
    dirtyRef.current = false;
    router.push(href);
  }, [pending, router]);

  return (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => (open ? undefined : setPending(null))}
      title={labels.title}
      description={labels.body}
      labels={{ cancel: labels.stay, confirm: labels.leave, working: labels.leave, close: labels.close }}
      onConfirm={leave}
    />
  );
}
