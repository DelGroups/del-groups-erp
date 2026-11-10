"use client";

import React from "react";
import Link from "next/link";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { splitHeaderActions } from "../logic";
import { Breadcrumbs } from "./Breadcrumbs";
import { buttonClass } from "./Button";
import { useDesignScope } from "./DesignScope";
import { useClaimCrumbs, usePageChrome } from "./PageChrome";
import { Truncate } from "./Truncate";

/** A page action that is not the primary one: a visible button or an item of the "…" menu. */
export interface HeaderAction {
  id: string;
  label: string;
  icon?: LucideIcon;
  /** A link (opens a page) or a handler. */
  href?: string;
  onSelect?: () => void;
  disabled?: boolean;
  /** Destructive: red text, last in the menu after a separator (ACT-5). Menu only. */
  danger?: boolean;
}

export interface PageHeaderProps {
  title: string;
  description?: string;
  /** Status chip of a record, next to the title (PAGE-1). */
  status?: React.ReactNode;
  /**
   * Above the title. Default: the shell's breadcrumbs in the unified UI (NAV-2); pass `false`
   * for none (Home) or a node of your own (old pages).
   */
  eyebrow?: React.ReactNode | false;
  /** The one primary action, rightmost (ACT-2, ACT-3): a <Button variant="primary"> or a link. */
  primary?: React.ReactNode;
  /** At most two visible secondary actions, left of the primary; more move into "…" (ACT-7). */
  secondary?: readonly HeaderAction[];
  /** Items of the "…" menu; danger items come last after a separator. */
  more?: readonly HeaderAction[];
  /** Name of the "…" button (default: the shell's text). */
  moreLabel?: string;
  /** Free actions (old API, SET-1 pages). New pages use primary / secondary / more. */
  actions?: React.ReactNode;
  className?: string;
}

function MenuItem({ action, onlyCompact }: { action: HeaderAction; onlyCompact?: boolean }) {
  const Icon = action.icon;
  const cls = ["ds-menu-item", action.danger ? "ds-menu-item-danger" : "", onlyCompact ? "ds-only-compact" : ""].filter(Boolean).join(" ");
  const body = (
    <>
      {Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
      <span className="truncate">{action.label}</span>
    </>
  );
  if (action.href && !action.disabled) {
    return (
      <Dropdown.Item asChild className={cls}>
        <Link href={action.href}>{body}</Link>
      </Dropdown.Item>
    );
  }
  return (
    <Dropdown.Item className={cls} disabled={action.disabled} onSelect={() => action.onSelect?.()}>
      {body}
    </Dropdown.Item>
  );
}

function ActionButton({ action }: { action: HeaderAction }) {
  const Icon = action.icon;
  const body = (
    <>
      {Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
      <span className="truncate">{action.label}</span>
    </>
  );
  const cls = buttonClass("secondary", "md", "ds-hide-compact");
  if (action.href && !action.disabled) {
    return (
      <Link href={action.href} className={cls}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} disabled={action.disabled} onClick={action.onSelect}>
      {body}
    </button>
  );
}

/**
 * The one page header of the UI rulebook (PAGE-1, ACT-2/3/7, NAV-2): breadcrumbs above one
 * <h1> (one line, ellipsis and tooltip), an optional status chip and one-line description, and
 * the actions on the right: at most two secondaries, then the primary; everything else in "…".
 * On phones the secondaries move into "…" too. There is no back link (NAV-4): back is the shell.
 */
export function PageHeader({ title, description, status, eyebrow, primary, secondary = [], more = [], moreLabel, actions, className }: PageHeaderProps) {
  const chrome = usePageChrome();
  const { portalContainer } = useDesignScope();
  const ownEyebrow = eyebrow !== undefined;
  const showCrumbs = !ownEyebrow && !!chrome && chrome.crumbs.length > 1;
  useClaimCrumbs(showCrumbs);

  const { visible, overflow } = splitHeaderActions(secondary, more);
  const plain = more.filter((a) => !a.danger);
  const danger = more.filter((a) => a.danger);
  const menuLabel = moreLabel ?? chrome?.labels.more ?? "…";
  // "…" shows on desktop for overflow and menu items; on phones also for the visible secondaries.
  const menuOnDesktop = overflow.length + more.length > 0;
  const menuOnPhone = menuOnDesktop || visible.length > 0;

  const crumbs = showCrumbs && chrome ? <Breadcrumbs crumbs={chrome.crumbs} label={chrome.labels.breadcrumb} moreLabel={chrome.labels.more} backToLabel={chrome.labels.backTo} /> : null;
  const top = ownEyebrow ? (eyebrow === false ? null : eyebrow) : crumbs;

  return (
    <header className={["ds-page-header", className].filter(Boolean).join(" ")}>
      <div className="ds-section-heading">
        {top ? <div className="ds-page-eyebrow">{top}</div> : null}
        <div className="ds-page-title-row">
          <Truncate as="h1" className="ds-page-title">
            {title}
          </Truncate>
          {status ? <span className="ds-page-status">{status}</span> : null}
        </div>
        {description ? <p className="ds-page-description">{description}</p> : null}
      </div>
      {actions || primary || menuOnPhone ? (
        <div className="ds-section-actions ds-page-actions">
          {actions}
          {visible.map((a) => (
            <ActionButton key={a.id} action={a} />
          ))}
          {menuOnPhone ? (
            <Dropdown.Root>
              <Dropdown.Trigger className={["ds-icon-btn ds-page-more", menuOnDesktop ? "" : "ds-only-compact"].filter(Boolean).join(" ")} aria-label={menuLabel}>
                <MoreHorizontal className="h-5 w-5" aria-hidden />
              </Dropdown.Trigger>
              <Dropdown.Portal container={portalContainer ?? undefined}>
                <Dropdown.Content align="end" sideOffset={6} className="ds-menu">
                  {visible.map((a) => (
                    <MenuItem key={a.id} action={a} onlyCompact />
                  ))}
                  {overflow.map((a) => (
                    <MenuItem key={a.id} action={a} />
                  ))}
                  {plain.map((a) => (
                    <MenuItem key={a.id} action={a} />
                  ))}
                  {danger.length ? <Dropdown.Separator className="ds-menu-sep" /> : null}
                  {danger.map((a) => (
                    <MenuItem key={a.id} action={a} />
                  ))}
                </Dropdown.Content>
              </Dropdown.Portal>
            </Dropdown.Root>
          ) : null}
          {primary}
        </div>
      ) : null}
    </header>
  );
}

export interface PageFrameProps {
  /** The PageHeader. */
  header: React.ReactNode;
  /** KPI cards (at most 4, one row), between the header and the toolbar (PAGE-2). */
  kpis?: React.ReactNode;
  /** The toolbar of a list or board (search, filters, view switch). */
  toolbar?: React.ReactNode;
  /** The sticky save bar of a form (FormSaveBar). */
  footer?: React.ReactNode;
  /** "full": lists and reports (content up to 120 rem); "form": forms and settings (75 rem). */
  width?: "full" | "form";
  className?: string;
  children?: React.ReactNode;
}

/**
 * The page frame of the UI rulebook (PAGE-2): header → KPIs → toolbar → content → save bar, on
 * the page background (no card around the whole page), 24 px between parts. Marks the page as
 * migrated (data-ui-page), so `npm run ui:guard` applies the page rules to it.
 */
export function PageFrame({ header, kpis, toolbar, footer, width = "full", className, children }: PageFrameProps) {
  return (
    <div className={["ds-page-frame", className].filter(Boolean).join(" ")} data-width={width} data-ui-page="">
      {header}
      {kpis ? <div className="ds-page-kpis">{kpis}</div> : null}
      {toolbar}
      {children}
      {footer}
    </div>
  );
}
