"use client";

import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { useDesignScope } from "@/design-system/components";
import { motionPreset, overlayVariants, transitions } from "@/design-system/motion";

/**
 * Side panel that opens one record over its list (records without a page of their own):
 * focus moves into it, Esc or the backdrop closes it, and it slides in from the right
 * (instantly with reduced motion). Full width on phones.
 */
export function RecordPanel({ open, onClose, title, closeLabel, children }: { open: boolean; onClose: () => void; title: string; closeLabel: string; children: React.ReactNode }) {
  const { portalContainer } = useDesignScope();
  const reduced = useReducedMotion();
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <AnimatePresence>
        {open ? (
          <Dialog.Portal forceMount container={portalContainer ?? undefined}>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="ds-overlay" variants={motionPreset(overlayVariants, reduced)} initial="initial" animate="enter" exit="exit" />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="fixed inset-y-0 right-0 z-[61] flex w-full max-w-5xl flex-col"
                style={{ background: "var(--ds-bg)", boxShadow: "var(--ds-elevation-4)" }}
                initial={reduced ? { opacity: 0 } : { x: "100%" }}
                animate={reduced ? { opacity: 1 } : { x: 0 }}
                exit={reduced ? { opacity: 0 } : { x: "100%" }}
                transition={reduced ? transitions.instant : transitions.base}
              >
                <div className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--ds-border)" }}>
                  <Dialog.Title className="truncate font-semibold">{title}</Dialog.Title>
                  <Dialog.Close className="ds-icon-btn" aria-label={closeLabel}>
                    <X className="h-4 w-4" aria-hidden />
                  </Dialog.Close>
                </div>
                <div className="flex-1 overflow-y-auto p-3 md:p-5">{children}</div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}
