"use client";

import React, { useEffect, useId, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useI18n } from "@/i18n/I18nProvider";
import {
  avatarLabelKey,
  avatarMotion,
  avatarTone,
  nextBlinkDelayMs,
  TONE_TOKEN,
  type AvatarSize,
  type AvatarState,
} from "@/lib/assistant/ui/avatar";

export interface AssistantAvatarProps {
  state: AvatarState;
  /** 28 header button, 40 panel header, 56 empty state. */
  size?: AvatarSize;
  /** Inside a button that already names itself: hidden from assistive tech. */
  decorative?: boolean;
  /** Force reduced motion (the review page shows both); otherwise the OS setting decides. */
  reducedMotion?: boolean;
  className?: string;
}

const EASE = [0.65, 0, 0.35, 1] as const;

/**
 * Del Assistant's face (AST-2, plan section 6): a soft rounded body with two eyes and a small spark, drawn
 * in SVG with design tokens only, so it follows the light and dark themes and the tenant's brand colour.
 * Every state has its own small motion; with "reduce motion" nothing moves and only the colour and the
 * eyes change (A11Y-5).
 */
export function AssistantAvatar({ state, size = 40, decorative = false, reducedMotion, className }: AssistantAvatarProps) {
  const { t } = useI18n();
  const osReduced = useReducedMotion();
  const reduced = reducedMotion ?? osReduced ?? false;
  const plan = avatarMotion(state, reduced);
  const tone = TONE_TOKEN[avatarTone(state)];
  const glowId = useId();
  const [blinking, setBlinking] = useState(false);

  // Blinks at random every 4–7 s while the state allows it.
  useEffect(() => {
    if (!plan.blink) return;
    let open: number | undefined;
    let next: number | undefined;
    const schedule = () => {
      next = window.setTimeout(() => {
        setBlinking(true);
        open = window.setTimeout(() => {
          setBlinking(false);
          schedule();
        }, 140);
      }, nextBlinkDelayMs());
    };
    schedule();
    return () => {
      window.clearTimeout(next);
      window.clearTimeout(open);
      setBlinking(false);
    };
  }, [plan.blink]);

  const label = t(avatarLabelKey(state));
  const look = plan.lookDown ? { x: -1.5, y: 2 } : { x: 0, y: 0 };
  const eyesClosed = plan.eyes === "closed" || (blinking && plan.eyes === "open");

  // One motion for the whole body: entering a state can shake or hop once; loops breathe or bounce.
  const bodyAnimate = plan.shake
    ? { x: [0, -3, 3, -2, 2, 0], y: 0, scale: 1 }
    : plan.hop
      ? { y: [0, -5, 0], x: 0, scale: 1 }
      : plan.bounce
        ? { y: [0, -1.6, 0], x: 0, scale: 1 }
        : plan.breathe
          ? { scale: [1, 1.03, 1], x: 0, y: 0 }
          : { x: 0, y: 0, scale: 1 };
  const bodyTransition = plan.shake
    ? { duration: 0.3, ease: "easeInOut" as const }
    : plan.hop
      ? { duration: 0.42, ease: EASE }
      : plan.bounce
        ? { duration: 0.5, ease: "easeInOut" as const, repeat: Infinity }
        : plan.breathe
          ? { duration: state === "sleeping" ? 4.8 : 3.4, ease: "easeInOut" as const, repeat: Infinity }
          : { duration: 0.2 };

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={["ds-assistant-avatar", className].filter(Boolean).join(" ")}
      data-state={state}
      data-size={size}
      {...(decorative ? { "aria-hidden": true, focusable: false } : { role: "img", "aria-label": label })}
    >
      {decorative ? null : <title>{label}</title>}
      <defs>
        <radialGradient id={glowId} cx="50%" cy="50%" r="50%">
          <stop offset="60%" stopColor={tone} stopOpacity="0.35" />
          <stop offset="100%" stopColor={tone} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Attention: a soft glow ring that pulses (static and faint with reduced motion). */}
      {state === "attention" ? (
        <motion.circle
          cx="32"
          cy="34"
          r="30"
          fill={`url(#${glowId})`}
          initial={false}
          animate={plan.pulse ? { opacity: [0.9, 0.2, 0.9], scale: [0.92, 1.04, 0.92] } : { opacity: 0.6, scale: 1 }}
          transition={plan.pulse ? { duration: 1.6, ease: "easeInOut", repeat: Infinity } : { duration: 0 }}
          style={{ transformOrigin: "32px 34px" }}
        />
      ) : null}

      <motion.g
        key={plan.shake || plan.hop ? state : "loop"}
        initial={false}
        animate={bodyAnimate}
        transition={bodyTransition}
        style={{ transformOrigin: "32px 56px" }}
      >
        {/* Body: a soft rounded pebble in the tone of the state. */}
        <rect x="9" y="12" width="46" height="44" rx="20" className="ds-assistant-avatar-body" style={{ fill: tone }} />
        {/* A quiet highlight so the shape reads as a body, not a button. */}
        <path d="M19 22 Q24 16 32 16" fill="none" stroke="var(--ds-brand-fg)" strokeOpacity="0.35" strokeWidth="3" strokeLinecap="round" />

        {/* Eyes */}
        <motion.g initial={false} animate={look} transition={{ duration: 0.24, ease: EASE }}>
          {plan.eyes === "arcs" ? (
            <g fill="none" stroke="var(--ds-brand-fg)" strokeWidth="3.2" strokeLinecap="round">
              <path d="M21.5 35 Q25 30 28.5 35" />
              <path d="M35.5 35 Q39 30 42.5 35" />
            </g>
          ) : eyesClosed ? (
            <g fill="none" stroke="var(--ds-brand-fg)" strokeWidth="3" strokeLinecap="round">
              <path d="M21.5 34 H28.5" />
              <path d="M35.5 34 H42.5" />
            </g>
          ) : (
            <g fill="var(--ds-brand-fg)">
              <rect x="22.5" y="28" width="5" height="10" rx="2.5" />
              <rect x="36.5" y="28" width="5" height="10" rx="2.5" />
            </g>
          )}
        </motion.g>
      </motion.g>

      {/* The spark: Del Assistant's mark, top right; it grows a little when a reply is done. */}
      <motion.path
        d="M52 3 Q53.2 8.8 59 10 Q53.2 11.2 52 17 Q50.8 11.2 45 10 Q50.8 8.8 52 3 Z"
        style={{ fill: tone, transformOrigin: "52px 10px" }}
        className="ds-assistant-avatar-spark"
        initial={false}
        animate={plan.hop ? { scale: [1, 1.35, 1], rotate: [0, 20, 0] } : { scale: state === "sleeping" ? 0.7 : 1, rotate: 0 }}
        transition={plan.hop ? { duration: 0.5, ease: EASE } : { duration: 0.2 }}
      />

      {/* Thinking: three dots orbit the body (standing still with reduced motion). */}
      {state === "thinking" ? (
        <motion.g
          initial={false}
          animate={plan.orbit ? { rotate: 360 } : { rotate: 0 }}
          transition={plan.orbit ? { duration: 1.6, ease: "linear", repeat: Infinity } : { duration: 0 }}
          style={{ transformOrigin: "32px 34px" }}
        >
          {[0, 120, 240].map((deg, i) => {
            const rad = ((deg - 90) * Math.PI) / 180;
            return <circle key={deg} cx={32 + 27 * Math.cos(rad)} cy={34 + 27 * Math.sin(rad)} r={2.6 - i * 0.5} style={{ fill: tone }} />;
          })}
        </motion.g>
      ) : null}
    </svg>
  );
}

export default AssistantAvatar;
