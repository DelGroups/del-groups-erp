import React from "react";
import type { LucideIcon } from "lucide-react";

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** Primary action, usually a button. */
  action?: React.ReactNode;
  /** Optional secondary link under the action. */
  secondary?: React.ReactNode;
  className?: string;
}

/** Empty container (reference bonus/bonus-empty-state): icon badge, heading, sentence, action. */
export function EmptyState({ icon: Icon, title, description, action, secondary, className }: EmptyStateProps) {
  return (
    <div
      className={["flex flex-col items-center justify-center gap-3 px-6 py-12 text-center", className].filter(Boolean).join(" ")}
      style={{ border: "1.5px dashed var(--ds-border-strong)", borderRadius: "var(--ds-radius-xl)" }}
    >
      <span className="grid h-12 w-12 place-items-center rounded-full" style={{ background: "var(--ds-brand-soft)", color: "var(--ds-brand)" }} aria-hidden>
        <Icon className="h-6 w-6" />
      </span>
      <h3 className="text-[length:var(--ds-text-lg)] font-semibold">{title}</h3>
      {description ? <p className="max-w-sm ds-muted">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
      {secondary ? <div className="text-[length:var(--ds-text-xs)]">{secondary}</div> : null}
    </div>
  );
}
