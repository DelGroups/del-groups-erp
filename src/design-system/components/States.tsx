"use client";

import { AlertCircle, RotateCcw } from "lucide-react";
import { Button } from "./Button";
import { Skeleton } from "./Skeleton";

/*
 * Page and section states of the UI rulebook (UI-7): EmptyState (./EmptyState.tsx) for "nothing
 * here yet", ErrorState for a failed load, LoadingState for the first load. Texts come from the
 * caller (src/i18n/uiUnifiedLabels.ts).
 */

export interface ErrorStateProps {
  title: string;
  /** What went wrong and what to do next, in plain words (OVL-3). */
  description?: string;
  /** Retry button text; with onRetry the button shows. */
  retryLabel?: string;
  onRetry?: () => void;
  className?: string;
}

/** A load that failed: icon, heading, what to do, one Retry button. Announced to screen readers. */
export function ErrorState({ title, description, retryLabel, onRetry, className }: ErrorStateProps) {
  return (
    <div className={["ds-state", className].filter(Boolean).join(" ")} role="alert">
      <span className="ds-state-icon ds-state-icon-danger" aria-hidden>
        <AlertCircle className="h-6 w-6" />
      </span>
      <h3 className="ds-state-title">{title}</h3>
      {description ? <p className="ds-state-text">{description}</p> : null}
      {onRetry && retryLabel ? (
        <Button icon={RotateCcw} onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

export interface LoadingStateProps {
  /** Announced to screen readers ("Loading…"); nothing is shown as text. */
  label: string;
  /** "list": rows; "form": label/field pairs; "cards": a grid of cards. */
  variant?: "list" | "form" | "cards";
  rows?: number;
  className?: string;
}

/**
 * First load of a page part: a skeleton in the shape of what comes (PERF-1), never a spinner on an
 * empty page. aria-busy, with the label for screen readers.
 */
export function LoadingState({ label, variant = "list", rows = 6, className }: LoadingStateProps) {
  const n = Math.max(1, rows);
  return (
    <div className={["ds-loading", className].filter(Boolean).join(" ")} role="status" aria-busy="true" aria-label={label} data-variant={variant}>
      {variant === "cards" ? (
        <div className="ds-loading-cards">
          {Array.from({ length: n }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : variant === "form" ? (
        Array.from({ length: n }, (_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))
      ) : (
        Array.from({ length: n }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)
      )}
      <span className="sr-only">{label}</span>
    </div>
  );
}
