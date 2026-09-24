"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

export type TableColumnWidths = Record<string, number>;

export interface TableColumnSpec {
  /** Base width in px — the column's share before any spare container width is handed out. */
  width: number;
  minWidth?: number;
  maxWidth?: number;
  /**
   * Fluid weight. Columns with `grow > 0` absorb the container width left over
   * after every column gets its base width, split proportionally by weight.
   * Content-fit columns omit it and stay at exactly their base width.
   */
  grow?: number;
}

export type TableColumnSpecs = Record<string, TableColumnSpec>;

const DEFAULT_MIN = 40;
const DEFAULT_MAX = 1200;

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readStoredWidths(storageKey: string | undefined): TableColumnWidths | null {
  if (!storageKey || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as TableColumnWidths;
  } catch {
    return null;
  }
}

function initialWidths(specs: TableColumnSpecs, storageKey: string | undefined): TableColumnWidths {
  const stored = readStoredWidths(storageKey) || {};
  const out: TableColumnWidths = {};
  for (const [key, spec] of Object.entries(specs)) {
    const saved = stored[key];
    const base = typeof saved === "number" && Number.isFinite(saved) ? saved : spec.width;
    out[key] = clamp(base, spec.minWidth ?? DEFAULT_MIN, spec.maxWidth ?? DEFAULT_MAX);
  }
  return out;
}

/**
 * Distributes `containerWidth` over the visible columns: every column gets its
 * base width, and whatever is left over goes to the `grow` columns by weight.
 * When the bases already exceed the container, nothing grows and the table
 * scrolls horizontally instead.
 */
function layoutColumns(
  specs: TableColumnSpecs,
  bases: TableColumnWidths,
  visibleKeys: string[],
  containerWidth: number
): TableColumnWidths {
  const totalBase = visibleKeys.reduce((sum, key) => sum + bases[key], 0);
  const growKeys = visibleKeys.filter((key) => (specs[key].grow ?? 0) > 0);
  const totalGrow = growKeys.reduce((sum, key) => sum + (specs[key].grow ?? 0), 0);
  const extra = Math.max(0, Math.floor(containerWidth) - totalBase);

  const rendered: TableColumnWidths = {};
  for (const key of visibleKeys) rendered[key] = bases[key];
  if (extra === 0 || totalGrow === 0) return rendered;

  let handedOut = 0;
  for (const key of growKeys) {
    const share = Math.floor((extra * (specs[key].grow ?? 0)) / totalGrow);
    rendered[key] += share;
    handedOut += share;
  }
  // Rounding leftovers go to the first fluid column so the row sums exactly to the container.
  rendered[growKeys[0]] += extra - handedOut;
  return rendered;
}

/**
 * Drag-to-resize columns for a plain HTML `<table>` with fluid + content-fit
 * columns. Spread `tableProps` on the `<table>`, attach `containerRef` to its
 * horizontal-scroll wrapper, and spread `columnProps(key)` onto each
 * `<ResizableTh>`. The table always fills 100% of the wrapper: spare width
 * flows into the `grow` columns, and the table scrolls once columns are
 * dragged wider than the screen.
 *
 * Grids without a column spec don't need this hook — any `<table>` in the app
 * is already drag-resizable via the global `<TableColumnResizer />`.
 *
 * Widths are optionally persisted per viewer via `storageKey` (localStorage).
 */
export function useTableResize(
  specs: TableColumnSpecs,
  options: { storageKey?: string; hiddenKeys?: readonly string[] } = {}
) {
  const { storageKey, hiddenKeys } = options;
  const [bases, setBases] = useState<TableColumnWidths>(() => initialWidths(specs, storageKey));
  const [containerWidth, setContainerWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const hiddenSignature = (hiddenKeys ?? []).join("|");
  const visibleKeys = useMemo(() => {
    const hidden = new Set(hiddenSignature ? hiddenSignature.split("|") : []);
    return Object.keys(specs).filter((key) => !hidden.has(key));
  }, [specs, hiddenSignature]);

  const rendered = useMemo(
    () => layoutColumns(specs, bases, visibleKeys, containerWidth),
    [specs, bases, visibleKeys, containerWidth]
  );
  const totalBase = visibleKeys.reduce((sum, key) => sum + bases[key], 0);

  // Latest layout inputs for the (non-React) mousemove listener.
  const layoutRef = useRef({ specs, bases, visibleKeys, containerWidth, rendered });
  useIsoLayoutEffect(() => {
    layoutRef.current = { specs, bases, visibleKeys, containerWidth, rendered };
  });

  useIsoLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setContainerWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(bases));
    } catch {
      // Private-mode / quota errors are fine to ignore — this is a per-viewer convenience only.
    }
  }, [bases, storageKey]);

  const dragRef = useRef<{ columnKey: string; startX: number; startRendered: number } | null>(null);
  const stopResizeRef = useRef<() => void>(() => {});

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const { specs: s, bases: b, visibleKeys: keys, containerWidth: c } = layoutRef.current;
    const spec = s[drag.columnKey];
    const min = spec.minWidth ?? DEFAULT_MIN;
    const max = spec.maxWidth ?? DEFAULT_MAX;
    const target = clamp(drag.startRendered + (e.clientX - drag.startX), min, max);

    // Solve for the base width that renders this column at `target` px, so the
    // border tracks the mouse even while the column is receiving spare width.
    let nextBase = target;
    const grow = spec.grow ?? 0;
    if (grow > 0) {
      const othersBase = keys.reduce((sum, key) => (key === drag.columnKey ? sum : sum + b[key]), 0);
      const totalGrow = keys.reduce((sum, key) => sum + (s[key].grow ?? 0), 0);
      const room = c - othersBase; // this column's width when it alone fills the gap
      const k = grow / totalGrow; // its share of any spare width
      if (target < room && k < 1) nextBase = (target - room * k) / (1 - k);
    }
    nextBase = Math.round(clamp(nextBase, min, max));
    setBases((prev) => (prev[drag.columnKey] === nextBase ? prev : { ...prev, [drag.columnKey]: nextBase }));
  }, []);

  useEffect(() => {
    stopResizeRef.current = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", stopResizeRef.current);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    return () => stopResizeRef.current();
  }, [handleMouseMove]);

  const startResize = useCallback(
    (columnKey: string) => (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = {
        columnKey,
        startX: e.clientX,
        startRendered: layoutRef.current.rendered[columnKey] ?? layoutRef.current.bases[columnKey],
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", stopResizeRef.current);
    },
    [handleMouseMove]
  );

  const resetWidths = useCallback(() => {
    setBases(initialWidths(specs, undefined));
    if (!storageKey) return;
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
  }, [specs, storageKey]);

  const columnProps = useCallback(
    (columnKey: string) => ({
      columnKey,
      width: rendered[columnKey] ?? bases[columnKey],
      minWidth: specs[columnKey].minWidth ?? DEFAULT_MIN,
      onResizeStart: startResize,
      onResetWidth: resetWidths,
    }),
    [rendered, bases, specs, startResize, resetWidths]
  );

  const tableProps = {
    "data-col-resize": "manual",
    style: { width: "100%", minWidth: totalBase, tableLayout: "fixed" as const },
  };

  return { containerRef, tableProps, columnProps, widths: rendered, resetWidths };
}
