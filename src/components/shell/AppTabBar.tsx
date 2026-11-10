"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { scrollLeftToReveal, tabScrollEdges } from "@/lib/shell/shell";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The app's tab bar in the shell header (SET-1 fix). Apps with many pages (Settings, Trade,
 * Inventory …) used to show a thick native scrollbar under the tabs on Windows. Now:
 *   - the scrollbar is hidden (`.ds-tabbar-scroller`: scrollbar-width none + ::-webkit-scrollbar);
 *   - it still scrolls with the wheel (vertical wheel moves it sideways), touch and the keyboard
 *     (Tab to a hidden tab brings it into view);
 *   - a soft fade and a small arrow button show only on a side that hides tabs;
 *   - the active tab is scrolled into view on load and on every page change.
 * Chosen over a "More" menu: every tab stays one click away in a fixed order, and the active
 * tab never moves into a menu.
 */
export function AppTabBar({ label, items, currentPath, renderLink }: {
  label: string;
  items: readonly { path: string; title: string }[];
  currentPath: string | null;
  renderLink: (item: { path: string; title: string }, active: boolean) => React.ReactNode;
}) {
  const { t } = useI18n();
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const next = tabScrollEdges(el.scrollLeft, el.clientWidth, el.scrollWidth);
    setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, []);

  // Keep the edges right when the window, the labels (language) or the list change.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [measure, items]);

  // Bring the active tab into view (only the bar scrolls: no scrollIntoView, which would also
  // move the page scroller).
  useIsoLayoutEffect(() => {
    const el = scroller.current;
    const tab = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!el || !tab) return;
    const target = scrollLeftToReveal(tab.offsetLeft, tab.offsetWidth, el.scrollLeft, el.clientWidth);
    if (target !== el.scrollLeft) el.scrollLeft = target;
    measure();
  }, [currentPath, items, measure]);

  // A vertical wheel (most mice) scrolls the bar sideways while there is room to scroll.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      const before = el.scrollLeft;
      el.scrollLeft += event.deltaY;
      if (el.scrollLeft !== before) event.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const page = (dir: -1 | 1) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.6), behavior: "smooth" });
  };

  return (
    <nav aria-label={label} className="ds-tabbar" data-fade-start={edges.start ? "" : undefined} data-fade-end={edges.end ? "" : undefined}>
      {edges.start ? (
        <button type="button" className="ds-tabbar-arrow ds-tabbar-arrow-start" tabIndex={-1} aria-label={t("newShell.tabsScrollBack")} title={t("newShell.tabsScrollBack")} onClick={() => page(-1)}>
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
      <div ref={scroller} className="ds-tabbar-scroller" onScroll={measure}>
        <ul className="flex gap-5">
          {items.map((item) => (
            <li key={item.path}>{renderLink(item, item.path === currentPath)}</li>
          ))}
        </ul>
      </div>
      {edges.end ? (
        <button type="button" className="ds-tabbar-arrow ds-tabbar-arrow-end" tabIndex={-1} aria-label={t("newShell.tabsScrollForward")} title={t("newShell.tabsScrollForward")} onClick={() => page(1)}>
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </nav>
  );
}
