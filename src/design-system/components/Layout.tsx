"use client";

import React, { useId } from "react";
import { Truncate } from "./Truncate";

/*
 * Layout pieces of the UI standard (UI-1, docs/ui-standard.md): fields, form grids, inline
 * groups, sections, toolbars and page headers. Texts come from the caller (src/i18n). Titles
 * and labels stay on one line (ellipsis + tooltip); action slots never push a title to wrap.
 */

export type FieldSpan = 1 | 2 | 3 | 4 | "full";
// Literal class names, so Tailwind finds them. Container queries: the grid follows its own
// width (a dialog, a side panel), not the window's.
const SPAN: Record<FieldSpan, string> = {
  1: "",
  2: "@md:col-span-2",
  3: "@md:col-span-2 @3xl:col-span-3",
  4: "@md:col-span-2 @3xl:col-span-3 @5xl:col-span-4",
  full: "col-span-full",
};

export interface FieldProps {
  label: string;
  /** Shows the required mark; the control itself carries aria-required. */
  required?: boolean;
  /** Text under the control. */
  hint?: string;
  /** Error under the control (replaces the hint). */
  error?: string | null;
  /** Columns taken in a FormGrid. */
  span?: FieldSpan;
  /** "stacked": label above the control (default). "inline": label left, fixed label column. */
  layout?: "stacked" | "inline";
  className?: string;
  /** The control. A function receives the ids to wire label, hint and error. */
  children: React.ReactNode | ((ids: { id: string; describedBy: string | undefined; invalid: boolean }) => React.ReactNode);
  /** Id of the control when children is a node (default: generated, use the function form). */
  htmlFor?: string;
}

/** Label, required mark, hint or error, and the control, in one unit. */
export function Field({ label, required, hint, error, span = 1, layout = "stacked", className, children, htmlFor }: FieldProps) {
  const auto = useId();
  const id = htmlFor ?? auto;
  const noteId = `${id}-note`;
  const note = error || hint;
  const control =
    typeof children === "function" ? children({ id, describedBy: note ? noteId : undefined, invalid: !!error }) : children;
  return (
    <div className={["ds-field", SPAN[span], className].filter(Boolean).join(" ")} data-layout={layout} data-invalid={error ? "" : undefined}>
      <div className="ds-field-label">
        <Truncate as="label" htmlFor={id}>
          {label}
        </Truncate>
        {required ? (
          <span className="ds-field-required" aria-hidden>
            *
          </span>
        ) : null}
      </div>
      <div className="ds-field-control">
        {control}
        {note ? (
          <p id={noteId} className={error ? "ds-field-error" : "ds-field-hint"} role={error ? "alert" : undefined}>
            {note}
          </p>
        ) : null}
      </div>
    </div>
  );
}

const COLUMNS: Record<1 | 2 | 3 | 4, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 @md:grid-cols-2",
  3: "grid-cols-1 @md:grid-cols-2 @3xl:grid-cols-3",
  4: "grid-cols-1 @md:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4",
};

/** Responsive form grid: 1 column when narrow, up to `columns` when wide; fields span with `span`. */
export function FormGrid({ columns = 2, className, children }: { columns?: 1 | 2 | 3 | 4; className?: string; children: React.ReactNode }) {
  return (
    <div className="@container min-w-0">
      <div className={["ds-form-grid grid", COLUMNS[columns], className].filter(Boolean).join(" ")}>{children}</div>
    </div>
  );
}

/** A row of fields inside a FormGrid that always starts on its own line. */
export function FieldRow({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={["ds-field-row col-span-full", className].filter(Boolean).join(" ")}>{children}</div>;
}

/**
 * Controls on one line (a cost row, filters). When the line is full it wraps whole units, never
 * one control per line; controls size to content or to their width class (ds-w-xs … ds-w-lg).
 */
export function InlineGroup({ className, children, label }: { className?: string; children: React.ReactNode; label?: string }) {
  return (
    <div className={["ds-inline-group", className].filter(Boolean).join(" ")} role={label ? "group" : undefined} aria-label={label}>
      {children}
    </div>
  );
}

export interface SectionProps {
  title: string;
  description?: string;
  /** Icon or small buttons, right of the title; they never push the title to wrap. */
  actions?: React.ReactNode;
  /** Heading level of the title. */
  level?: 2 | 3;
  /** "card": surface with border (default); "plain": no frame, for sections inside a card. */
  variant?: "card" | "plain";
  className?: string;
  children?: React.ReactNode;
}

/** Card / section with a header: title (ellipsis + tooltip), description and actions. */
export function Section({ title, description, actions, level = 2, variant = "card", className, children }: SectionProps) {
  const titleId = useId();
  return (
    <section className={["ds-section", variant === "card" ? "ds-card" : "", className].filter(Boolean).join(" ")} aria-labelledby={titleId}>
      <header className="ds-section-header">
        <div className="ds-section-heading">
          <Truncate as={level === 2 ? "h2" : "h3"} id={titleId} className="ds-section-title">
            {title}
          </Truncate>
          {description ? <p className="ds-section-description">{description}</p> : null}
        </div>
        {actions ? <div className="ds-section-actions">{actions}</div> : null}
      </header>
      {children !== undefined ? <div className="ds-section-body">{children}</div> : null}
    </section>
  );
}

/** Same as Section; the name used for a stand-alone surface. */
export const Card = Section;

export interface ToolbarProps {
  /** Left: title, filters, search. */
  start?: React.ReactNode;
  /** Right: actions, then the settings icon. */
  end?: React.ReactNode;
  /** The settings icon button (an IconButton), always last. */
  settings?: React.ReactNode;
  label?: string;
  className?: string;
}

/** Bar above a list or a board: what is shown on the left, what you can do on the right. */
export function Toolbar({ start, end, settings, label, className }: ToolbarProps) {
  return (
    <div className={["ds-toolbar", className].filter(Boolean).join(" ")} role="toolbar" aria-label={label}>
      <div className="ds-toolbar-start">{start}</div>
      {end || settings ? (
        <div className="ds-toolbar-end">
          {end}
          {settings}
        </div>
      ) : null}
    </div>
  );
}

export interface PageHeaderProps {
  title: string;
  description?: string;
  /** Above the title (breadcrumbs). */
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

/** Title of a page with its main actions; the title is one line (ellipsis + tooltip). */
export function PageHeader({ title, description, eyebrow, actions, className }: PageHeaderProps) {
  return (
    <header className={["ds-page-header", className].filter(Boolean).join(" ")}>
      <div className="ds-section-heading">
        {eyebrow ? <div className="ds-page-eyebrow">{eyebrow}</div> : null}
        <Truncate as="h1" className="ds-page-title">
          {title}
        </Truncate>
        {description ? <p className="ds-section-description">{description}</p> : null}
      </div>
      {actions ? <div className="ds-section-actions">{actions}</div> : null}
    </header>
  );
}
