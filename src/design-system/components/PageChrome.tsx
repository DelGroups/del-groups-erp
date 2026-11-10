"use client";

import React, { createContext, useContext, useEffect } from "react";

/*
 * What the shell tells a page in the unified UI (UI-7, docs/ui-standard.md NAV-2, PAGE-1): the
 * breadcrumbs of the current page and their texts. The page's PageHeader shows the crumbs above
 * its title and claims them, so the shell hides its own crumb row; pages that are not migrated yet
 * keep the shell's row. Without a provider (classic shell, flag off) there are no crumbs.
 */

export interface ChromeCrumb {
  label: string;
  /** Missing on the current page (the last crumb). */
  href?: string;
}

export interface PageChromeLabels {
  /** aria-label of the breadcrumb nav. */
  breadcrumb: string;
  /** The "…" button of hidden crumbs and of page actions. */
  more: string;
  /** "Back to {page}" on phones, where only the parent crumb shows; {page} is filled in. */
  backTo: string;
}

export interface PageChromeValue {
  crumbs: readonly ChromeCrumb[];
  labels: PageChromeLabels;
  /** A PageHeader that shows the crumbs calls it on mount; the returned function releases them. */
  claimCrumbs: () => () => void;
}

const PageChromeContext = createContext<PageChromeValue | null>(null);

export function PageChromeProvider({ value, children }: { value: PageChromeValue; children: React.ReactNode }) {
  return <PageChromeContext.Provider value={value}>{children}</PageChromeContext.Provider>;
}

export function usePageChrome(): PageChromeValue | null {
  return useContext(PageChromeContext);
}

/** Claims the shell's crumbs while `active` (the header renders them itself). */
export function useClaimCrumbs(active: boolean): void {
  const chrome = usePageChrome();
  const claim = chrome?.claimCrumbs;
  useEffect(() => {
    if (!active || !claim) return;
    return claim();
  }, [active, claim]);
}
