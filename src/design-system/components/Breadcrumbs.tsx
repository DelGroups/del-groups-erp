"use client";

import React from "react";
import Link from "next/link";
import * as Popover from "@radix-ui/react-popover";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { collapseCrumbs } from "../../lib/shell/shell";
import { useDesignScope } from "./DesignScope";
import type { ChromeCrumb } from "./PageChrome";

export interface BreadcrumbsProps {
  crumbs: readonly ChromeCrumb[];
  /** aria-label of the nav landmark. */
  label: string;
  /** Name of the "…" button that holds the middle crumbs of a long trail. */
  moreLabel: string;
  /** "Back to {page}": the name of the phone's parent link. */
  backToLabel: string;
  /** Called before a crumb navigates (the shell starts a new trail). */
  onNavigate?: () => void;
  className?: string;
}

/**
 * Breadcrumbs of the UI rulebook (NAV-2, ARIA APG breadcrumb): an ordered list in a labelled nav;
 * every crumb but the last is a link, the last is the current page (aria-current="page"). One
 * line: a long trail keeps the first and the last two crumbs and puts the rest behind "…"; each
 * crumb ellipsizes. On phones only the parent shows, as "‹ Parent".
 */
export function Breadcrumbs({ crumbs, label, moreLabel, backToLabel, onNavigate, className }: BreadcrumbsProps) {
  const { portalContainer } = useDesignScope();
  if (crumbs.length < 2) return null;
  const { visible, hidden, collapsedAt } = collapseCrumbs(crumbs);
  const parent = [...crumbs.slice(0, -1)].reverse().find((c) => c.href);
  return (
    <nav aria-label={label} className={["ds-crumbs", className].filter(Boolean).join(" ")} data-ds-breadcrumbs="">
      {parent?.href ? (
        <Link href={parent.href} onClick={onNavigate} className="ds-crumbs-parent" aria-label={backToLabel.replace("{page}", parent.label)}>
          <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">{parent.label}</span>
        </Link>
      ) : null}
      <ol className="ds-crumbs-list">
        {visible.map((c, i) => {
          const last = i === visible.length - 1;
          return (
            <React.Fragment key={`${c.href ?? ""}:${c.label}:${i}`}>
              {collapsedAt === i ? (
                <li className="ds-crumbs-item">
                  <Popover.Root>
                    <Popover.Trigger className="ds-icon-btn ds-crumbs-more" aria-label={moreLabel}>
                      <MoreHorizontal className="h-4 w-4" aria-hidden />
                    </Popover.Trigger>
                    <Popover.Portal container={portalContainer ?? undefined}>
                      <Popover.Content align="start" sideOffset={6} className="ds-menu">
                        {hidden.map((h, k) =>
                          h.href ? (
                            <Link key={`${h.href}:${k}`} href={h.href} onClick={onNavigate} className="ds-menu-item">
                              {h.label}
                            </Link>
                          ) : (
                            <span key={`${h.label}:${k}`} className="ds-menu-item">
                              {h.label}
                            </span>
                          )
                        )}
                      </Popover.Content>
                    </Popover.Portal>
                  </Popover.Root>
                  <ChevronRight className="ds-crumbs-sep" aria-hidden />
                </li>
              ) : null}
              <li className="ds-crumbs-item">
                {c.href && !last ? (
                  <Link href={c.href} onClick={onNavigate} className="ds-crumbs-link" title={c.label}>
                    {c.label}
                  </Link>
                ) : (
                  <span className="ds-crumbs-current" aria-current={last ? "page" : undefined} title={c.label}>
                    {c.label}
                  </span>
                )}
                {last ? null : <ChevronRight className="ds-crumbs-sep" aria-hidden />}
              </li>
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
