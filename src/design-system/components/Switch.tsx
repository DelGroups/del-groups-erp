"use client";

import React, { useId } from "react";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  /** The visible label (A11Y-4: every control has a name). */
  label: string;
  /** One short line under the label. */
  description?: string;
  disabled?: boolean;
  /** Shown while the change is being saved; the switch stays where it was until it is done. */
  busy?: boolean;
}

/**
 * An on/off switch (yes / no settings, ui-standard "switch or checkbox"): a native button with
 * role="switch" and aria-checked, so Space and Enter toggle it and screen readers say its state. The label
 * is clickable; the track uses the design tokens and the global focus ring.
 */
export function Switch({ checked, onCheckedChange, label, description, disabled, busy }: SwitchProps) {
  const id = useId();
  return (
    <div className="ds-switch-row">
      <span className="ds-switch-text">
        <label htmlFor={id} className="ds-switch-label">
          {label}
        </label>
        {description ? (
          <span id={`${id}-d`} className="ds-switch-description">
            {description}
          </span>
        ) : null}
      </span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-d` : undefined}
        aria-busy={busy || undefined}
        disabled={disabled || busy}
        className="ds-switch"
        data-checked={checked || undefined}
        onClick={() => onCheckedChange(!checked)}
      >
        <span className="ds-switch-thumb" aria-hidden />
      </button>
    </div>
  );
}
