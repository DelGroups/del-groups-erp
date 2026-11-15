"use client";

import React, { useEffect, useId, useState } from "react";
import { useReducedMotion } from "motion/react";
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

/**
 * Del Assistant's face, "Orb" (chosen by Del, 2026-11-15): a glossy sphere with big eyes, catchlights and
 * soft cheeks. Its colours are mixed from one design token per state (brand, warning, danger, success,
 * muted), so it follows light and dark themes and the tenant's brand colour. Motion lives in
 * src/design-system/assistant.css and runs only for what avatarMotion() allows; with "reduce motion"
 * nothing moves and only the colour and the eyes change (A11Y-5).
 */
export function AssistantAvatar({ state, size = 40, decorative = false, reducedMotion, className }: AssistantAvatarProps) {
  const { t } = useI18n();
  const osReduced = useReducedMotion();
  const reduced = reducedMotion ?? osReduced ?? false;
  const plan = avatarMotion(state, reduced);
  const uid = `av${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
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
  const on = (v: boolean) => (v ? "" : undefined);

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={["ds-assistant-avatar", className].filter(Boolean).join(" ")}
      style={{ ["--av-tone" as string]: TONE_TOKEN[avatarTone(state)] }}
      data-state={state}
      data-size={size}
      data-float={on(plan.breathe)}
      data-bounce={on(plan.bounce)}
      data-orbit={on(plan.orbit)}
      data-pulse={on(plan.pulse)}
      data-shake={on(plan.shake)}
      data-hop={on(plan.hop)}
      data-look={on(plan.lookDown)}
      data-blink={on(blinking && plan.eyes === "open")}
      {...(decorative ? { "aria-hidden": true, focusable: false } : { role: "img", "aria-label": label })}
    >
      {decorative ? null : <title>{label}</title>}
      <defs>
        <radialGradient id={`${uid}b`} cx="38%" cy="32%" r="72%">
          <stop offset="0" style={{ stopColor: "var(--av-c1)" }} />
          <stop offset=".55" style={{ stopColor: "var(--av-c2)" }} />
          <stop offset="1" style={{ stopColor: "var(--av-c3)" }} />
        </radialGradient>
        <radialGradient id={`${uid}r`} cx="50%" cy="50%" r="50%">
          <stop offset=".78" style={{ stopColor: "var(--ds-brand-fg)", stopOpacity: 0 }} />
          <stop offset="1" style={{ stopColor: "var(--ds-brand-fg)", stopOpacity: 0.35 }} />
        </radialGradient>
        <radialGradient id={`${uid}a`} cx="50%" cy="50%" r="50%">
          <stop offset=".55" style={{ stopColor: "var(--av-tone)", stopOpacity: 0.45 }} />
          <stop offset="1" style={{ stopColor: "var(--av-tone)", stopOpacity: 0 }} />
        </radialGradient>
        <filter id={`${uid}f`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>

      {/* Warning: a soft aura that pulses (still, with reduced motion). */}
      {state === "attention" ? <circle className="ds-av-aura" cx="50" cy="50" r="49" fill={`url(#${uid}a)`} /> : null}
      <ellipse className="ds-av-shadow" cx="50" cy="94" rx="24" ry="3.2" />

      {/* Keyed by state, so the one-off motions (shake, hop) play again on every change. */}
      <g key={state} className="ds-av-body">
        <circle cx="50" cy="50" r="38" fill={`url(#${uid}b)`} />
        <circle cx="50" cy="50" r="38" fill={`url(#${uid}r)`} />
        <ellipse cx="37" cy="30" rx="14" ry="8" className="ds-av-gloss" filter={`url(#${uid}f)`} />
        <circle cx="31" cy="27" r="2.2" className="ds-av-spark" />

        <g className="ds-av-eyes">
          {plan.eyes === "arcs" ? (
            <g className="ds-av-stroke" strokeWidth="3.4">
              <path d="M33.5 53 Q39 45 44.5 53" />
              <path d="M55.5 53 Q61 45 66.5 53" />
            </g>
          ) : plan.eyes === "closed" ? (
            <g className="ds-av-stroke" strokeWidth="3">
              <path d="M33.5 52 Q39 56 44.5 52" />
              <path d="M55.5 52 Q61 56 66.5 52" />
            </g>
          ) : (
            <>
              <g className="ds-av-eye">
                <ellipse cx="39" cy="51" rx="5.6" ry="8.2" className="ds-av-pupil" />
                <circle cx="41" cy="47.5" r="2.1" className="ds-av-spark" />
                <circle cx="37.6" cy="54.5" r=".9" className="ds-av-spark" opacity=".7" />
              </g>
              <g className="ds-av-eye">
                <ellipse cx="61" cy="51" rx="5.6" ry="8.2" className="ds-av-pupil" />
                <circle cx="63" cy="47.5" r="2.1" className="ds-av-spark" />
                <circle cx="59.6" cy="54.5" r=".9" className="ds-av-spark" opacity=".7" />
              </g>
            </>
          )}
          {state === "sleeping" ? null : <ellipse className="ds-av-mouth" cx="50" cy="63.5" rx="3.4" ry="2" />}
        </g>
        {state === "sleeping" || state === "alert" ? null : (
          <>
            <ellipse className="ds-av-cheek" cx="30" cy="61" rx="5" ry="3" />
            <ellipse className="ds-av-cheek" cx="70" cy="61" rx="5" ry="3" />
          </>
        )}
      </g>

      {/* Thinking: a dotted ring turns around the orb (standing still with reduced motion). */}
      {state === "thinking" ? <circle className="ds-av-ring" cx="50" cy="50" r="46" /> : null}
      {/* Done: a short burst of light. */}
      {state === "success" && plan.hop ? <path className="ds-av-burst" d="M50 4v6M50 90v6M4 50h6M90 50h6M17 17l4 4M79 79l4 4M83 17l-4 4M21 79l-4 4" /> : null}
    </svg>
  );
}

export default AssistantAvatar;
