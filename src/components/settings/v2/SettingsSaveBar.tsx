"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Loader2, Save, Undo2 } from "lucide-react";
import { useDesignScope } from "@/design-system/components";
import { motionPreset, overlayVariants, panelVariants, transitions } from "@/design-system/motion";
import { useI18n } from "@/i18n/I18nProvider";
import { leaveTarget } from "@/lib/settings/form";

/**
 * The one save bar of a settings form (SETTINGS_V2): sticks to the bottom of the page scroller
 * (`erp-sticky-actions`) and shows only while something changed.
 */
export function SettingsSaveBar({ dirty, saving, disabled, onSave, onDiscard }: { dirty: boolean; saving: boolean; disabled?: boolean; onSave: () => void; onDiscard: () => void }) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {dirty || saving ? (
        <motion.div
          key="savebar"
          className="erp-sticky-actions ds-settings-savebar"
          role="region"
          aria-label={t("settingsNav.saveBar.unsaved")}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
          transition={reduced ? transitions.instant : transitions.base}
        >
          <div className="ds-settings-savebar-inner">
            <span className="ds-dot" style={{ background: "var(--ds-warning)" }} aria-hidden />
            <p className="min-w-0 flex-1 truncate font-medium" aria-live="polite">
              {t("settingsNav.saveBar.unsaved")}
            </p>
            <button type="button" className="ds-btn ds-btn-ghost" onClick={onDiscard} disabled={saving}>
              <Undo2 className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">{t("settingsNav.saveBar.discard")}</span>
            </button>
            <button type="button" className="ds-btn ds-btn-primary" onClick={onSave} disabled={saving || disabled}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
              {saving ? t("settingsNav.saveBar.saving") : t("settingsNav.saveBar.save")}
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * "Unsaved changes" warning while `dirty`: closing or reloading the tab asks the browser's own
 * question; a link inside the app (menu, crumbs, shell) opens our dialog first. Returns the dialog,
 * which the page renders.
 */
export function useUnsavedChangesGuard(dirty: boolean): React.ReactNode {
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

  return <LeaveDialog open={pending !== null} onStay={() => setPending(null)} onLeave={leave} />;
}

function LeaveDialog({ open, onStay, onLeave }: { open: boolean; onStay: () => void; onLeave: () => void }) {
  const { t } = useI18n();
  const { portalContainer } = useDesignScope();
  const reduced = useReducedMotion();
  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? undefined : onStay())}>
      <AnimatePresence>
        {open ? (
          <Dialog.Portal forceMount container={portalContainer ?? undefined}>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="ds-overlay" variants={motionPreset(overlayVariants, reduced)} initial="initial" animate="enter" exit="exit" />
            </Dialog.Overlay>
            <Dialog.Content forceMount className="pointer-events-none fixed inset-0 z-[var(--ds-z-modal-content)] grid place-items-center p-4">
              <motion.div
                className="ds-panel pointer-events-auto w-full max-w-[26rem] p-5"
                variants={motionPreset(panelVariants, reduced)}
                initial="initial"
                animate="enter"
                exit="exit"
              >
                <Dialog.Title className="text-[length:var(--ds-text-lg)] font-semibold">{t("settingsNav.leave.title")}</Dialog.Title>
                <Dialog.Description className="mt-1 ds-muted">{t("settingsNav.leave.body")}</Dialog.Description>
                <div className="mt-5 flex flex-wrap justify-end gap-2">
                  <button type="button" className="ds-btn" onClick={onStay} autoFocus>
                    {t("settingsNav.leave.stay")}
                  </button>
                  <button type="button" className="ds-btn ds-btn-danger" onClick={onLeave}>
                    {t("settingsNav.leave.leave")}
                  </button>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}
