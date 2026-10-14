"use client";

import React, { useEffect, useRef, useState } from "react";
import { animate, useInView, useReducedMotion } from "motion/react";
import { countUpValue, decimalsOf, formatFigure } from "../logic";
import { COUNT_UP_DURATION } from "../motion";

/**
 * A number that counts up from 0 the first time it scrolls into view
 * (stats/stats-count-up-metrics-on-view), keeping its decimals and thousands separators;
 * with reduced motion it shows the value at once. Screen readers get the final value.
 */
export function CountUp({ value, decimals, locale = "en", className }: { value: number; decimals?: number; locale?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });
  const reduced = useReducedMotion();
  const places = decimals ?? decimalsOf(value);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!inView || reduced) return;
    const controls = animate(0, 1, { duration: COUNT_UP_DURATION, ease: "linear", onUpdate: setProgress });
    return () => controls.stop();
  }, [inView, reduced]);

  const shown = reduced ? value : countUpValue(value, progress, places);
  return (
    <span ref={ref} className={className}>
      <span aria-hidden>{formatFigure(shown, places, locale)}</span>
      <span className="sr-only">{formatFigure(value, places, locale)}</span>
    </span>
  );
}

export interface BandMetric {
  value: number;
  prefix?: string;
  suffix?: string;
  label: string;
  note?: string;
}

/** The metrics band of the reference: label, heading, then up to four counting figures. */
export function MetricsBand({ eyebrow, heading, metrics, locale }: { eyebrow: string; heading: string; metrics: readonly BandMetric[]; locale?: string }) {
  return (
    <section
      className="px-6 py-10 text-center"
      style={{ background: "var(--ds-band-bg)", color: "var(--ds-band-text)", borderRadius: "var(--ds-radius-xl)" }}
    >
      <p className="text-[length:var(--ds-text-xs)] uppercase tracking-[0.14em]" style={{ color: "var(--ds-band-muted)" }}>
        {eyebrow}
      </p>
      <h3 className="mt-2 text-[length:var(--ds-text-xl)] font-semibold">{heading}</h3>
      <dl className="mt-8 grid grid-cols-2 gap-y-8 md:grid-cols-4 md:divide-x" style={{ borderColor: "var(--ds-band-rule)" }}>
        {metrics.map((m) => (
          <div key={m.label} className="flex flex-col items-center gap-1 px-4" style={{ borderColor: "var(--ds-band-rule)" }}>
            <dt className="order-2 font-medium">{m.label}</dt>
            <dd className="order-1 text-[length:var(--ds-text-2xl)] font-semibold tracking-tight ds-mono">
              {m.prefix ? <span className="mr-0.5 text-[length:var(--ds-text-lg)]" style={{ color: "var(--ds-band-muted)" }}>{m.prefix}</span> : null}
              <CountUp value={m.value} locale={locale} />
              {m.suffix ? <span className="ml-0.5 text-[length:var(--ds-text-lg)]" style={{ color: "var(--ds-band-muted)" }}>{m.suffix}</span> : null}
            </dd>
            {m.note ? <span className="order-3 text-[length:var(--ds-text-xs)]" style={{ color: "var(--ds-band-subtle)" }}>{m.note}</span> : null}
          </div>
        ))}
      </dl>
    </section>
  );
}
