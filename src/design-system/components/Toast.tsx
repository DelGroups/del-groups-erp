"use client";

import React, { createContext, useCallback, useContext, useMemo, useReducer, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { TOAST_DURATION, toastReducer, type ToastItem, type ToastVariant } from "../logic";
import { motionPreset, toastVariants } from "../motion";
import { useDesignScope } from "./DesignScope";

type ToastFn = (title: string, message?: string, variant?: ToastVariant) => string;

const ToastContext = createContext<{ toast: ToastFn; dismiss: (id: string) => void } | null>(null);

/** `toast(title, message, variant)` inside a <ToastProvider>. */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const ICON = { success: CheckCircle2, error: XCircle, info: Info } as const;
const COLOR = { success: "var(--ds-success)", error: "var(--ds-danger-strong)", info: "var(--ds-info)" } as const;

/**
 * Toasts (reference bonus/bonus-toast-notification): stacked bottom-right, each slides in,
 * counts its timer bar down over five seconds (paused while hovered or focused), then
 * leaves; the close button dismisses at once. Errors are announced assertively.
 */
export function ToastProvider({ children, closeLabel }: { children: React.ReactNode; closeLabel: string }) {
  const [toasts, dispatch] = useReducer(toastReducer, []);
  const seq = useRef(0);
  const { portalContainer } = useDesignScope();
  const reduced = useReducedMotion();

  const dismiss = useCallback((id: string) => dispatch({ type: "dismiss", id }), []);
  const toast = useCallback<ToastFn>((title, message, variant = "info") => {
    const id = `t${++seq.current}`;
    const item: ToastItem = { id, title, message, variant, duration: TOAST_DURATION };
    dispatch({ type: "add", toast: item });
    return id;
  }, []);
  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  const stack = (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = ICON[t.variant];
          return (
            <motion.div
              key={t.id}
              layout={!reduced}
              variants={motionPreset(toastVariants, reduced)}
              initial="initial"
              animate="enter"
              exit="exit"
              role={t.variant === "error" ? "alert" : "status"}
              className="ds-toast ds-panel pointer-events-auto relative overflow-hidden"
              style={{ boxShadow: "var(--ds-elevation-3)", borderRadius: "var(--ds-radius-lg)" }}
            >
              <div className="flex items-start gap-3 p-4 pr-10">
                <Icon className="mt-0.5 h-5 w-5 shrink-0" style={{ color: COLOR[t.variant] }} aria-hidden />
                <div className="min-w-0">
                  <p className="font-semibold">{t.title}</p>
                  {t.message ? <p className="mt-0.5 ds-muted">{t.message}</p> : null}
                </div>
              </div>
              <button type="button" className="ds-btn ds-btn-ghost ds-btn-sm absolute right-2 top-2" aria-label={closeLabel} onClick={() => dismiss(t.id)}>
                <X className="h-4 w-4" aria-hidden />
              </button>
              <div className="absolute inset-x-0 bottom-0 h-1" style={{ background: "var(--ds-track)" }} aria-hidden>
                <div
                  className="ds-toast-timer h-full"
                  style={{ background: COLOR[t.variant], animationDuration: `${t.duration}ms` }}
                  onAnimationEnd={() => dismiss(t.id)}
                />
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {portalContainer ? createPortal(stack, portalContainer) : null}
    </ToastContext.Provider>
  );
}
