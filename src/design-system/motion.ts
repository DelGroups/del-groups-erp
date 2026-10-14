/**
 * Shared motion of the new UI (prompt 15, plan §6.2), for the `motion` package
 * (`import { motion } from "motion/react"`). Every duration stays within the 200–300 ms
 * budget, and every preset has a reduced-motion form: when the visitor prefers reduced
 * motion, things appear and disappear without movement (opacity only, instantly).
 *
 * <DesignScope> wraps its children in <MotionConfig reducedMotion="user">, so motion
 * components follow the OS setting on their own; the helpers here are for code that builds
 * transitions by hand (count-up, layout ids) and for tests. Only types come from `motion`,
 * so plain Node can load this file.
 */
import type { Transition, Variants } from "motion/react";

/** Seconds, as motion expects (theme.css mirrors them as --ds-duration-*). */
export const DURATION = { fast: 0.2, base: 0.24, slow: 0.3 } as const;
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;

export const transitions = {
  fast: { duration: DURATION.fast, ease: EASE_OUT },
  base: { duration: DURATION.base, ease: EASE_OUT },
  slow: { duration: DURATION.slow, ease: EASE_IN_OUT },
  /** Shared layout (a record opening from its list row). */
  layout: { duration: 0.28, ease: EASE_IN_OUT },
  instant: { duration: 0 },
} as const satisfies Record<string, Transition>;

/** Page enter/leave: a short fade with a 8 px rise. Use with <AnimatePresence mode="wait">. */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  enter: { opacity: 1, y: 0, transition: transitions.base },
  exit: { opacity: 0, y: -4, transition: transitions.fast },
};

/** List container: staggers its children by 30 ms (a long list stays within budget). */
export const listVariants: Variants = {
  initial: {},
  enter: { transition: { staggerChildren: 0.03, delayChildren: 0.02 } },
};

/** List item: fade and slide in; removed items collapse. */
export const listItemVariants: Variants = {
  initial: { opacity: 0, y: 6 },
  enter: { opacity: 1, y: 0, transition: transitions.fast },
  exit: { opacity: 0, height: 0, transition: transitions.fast },
};

/** Overlays (dialog, palette): scale up from 96 % with the backdrop fading. */
export const overlayVariants: Variants = {
  initial: { opacity: 0 },
  enter: { opacity: 1, transition: transitions.fast },
  exit: { opacity: 0, transition: transitions.fast },
};
export const panelVariants: Variants = {
  initial: { opacity: 0, scale: 0.96, y: 8 },
  enter: { opacity: 1, scale: 1, y: 0, transition: transitions.base },
  exit: { opacity: 0, scale: 0.98, y: 4, transition: transitions.fast },
};

/** Toasts slide in from the right edge. */
export const toastVariants: Variants = {
  initial: { opacity: 0, x: 24, scale: 0.98 },
  enter: { opacity: 1, x: 0, scale: 1, transition: transitions.base },
  exit: { opacity: 0, x: 24, transition: transitions.fast },
};

/** The same variants with movement removed (opacity only, instant). */
export function reducedVariants(variants: Variants): Variants {
  const out: Variants = {};
  for (const [name, value] of Object.entries(variants)) {
    if (typeof value !== "object" || value === null) {
      out[name] = value;
      continue;
    }
    const v = value as Record<string, unknown>;
    out[name] = { ...("opacity" in v ? { opacity: v.opacity as number } : {}), transition: transitions.instant } as Variants[string];
  }
  return out;
}

/** Picks the normal or the reduced form. */
export function motionPreset(variants: Variants, reduced: boolean | null | undefined): Variants {
  return reduced ? reducedVariants(variants) : variants;
}

/**
 * layoutId shared by a list row and the record it opens, so motion animates one into the
 * other (`<motion.div layoutId={recordLayoutId("sales", id)}>` on both).
 */
export function recordLayoutId(model: string, id: string | number, part = "card"): string {
  return `record:${model}:${id}:${part}`;
}

/** Count-up timing, within the same budget; reduced motion jumps straight to the value. */
export const COUNT_UP_DURATION = DURATION.slow;
export function countUpTransition(reduced: boolean | null | undefined): Transition {
  return reduced ? transitions.instant : { duration: COUNT_UP_DURATION, ease: EASE_OUT };
}
