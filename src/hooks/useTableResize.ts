"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type TableColumnWidths = Record<string, number>;

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

/**
 * Generic mouse-drag column resizing for a plain HTML/Tailwind `<table>`.
 * Not tied to any one grid — pass a `defaultWidths` map keyed by column id
 * and drop the returned `startResize` handler onto a drag divider (see
 * `<ResizableTh>`). Widths are optionally persisted per-viewer via
 * `storageKey` (localStorage — never shared, never read back by the server).
 */
export function useTableResize(defaultWidths: TableColumnWidths, storageKey?: string) {
  const [widths, setWidths] = useState<TableColumnWidths>(() => ({
    ...defaultWidths,
    ...(readStoredWidths(storageKey) || {}),
  }));

  const dragRef = useRef<{
    columnKey: string;
    startX: number;
    startWidth: number;
    minWidth: number;
    maxWidth: number;
  } | null>(null);
  const widthsRef = useRef(widths);
  const stopResizeRef = useRef<() => void>(() => {});

  useEffect(() => {
    widthsRef.current = widths;
  }, [widths]);

  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(widths));
    } catch {
      // Private-mode / quota errors are fine to ignore — this is a per-viewer convenience only.
    }
  }, [widths, storageKey]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = e.clientX - drag.startX;
    const nextWidth = Math.min(drag.maxWidth, Math.max(drag.minWidth, drag.startWidth + delta));
    setWidths((prev) => (prev[drag.columnKey] === nextWidth ? prev : { ...prev, [drag.columnKey]: nextWidth }));
  }, []);

  useEffect(() => {
    stopResizeRef.current = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", stopResizeRef.current);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [handleMouseMove]);

  const startResize = useCallback(
    (columnKey: string, minWidth = 40, maxWidth = 900) =>
      (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragRef.current = {
          columnKey,
          startX: e.clientX,
          startWidth: widthsRef.current[columnKey] ?? minWidth,
          minWidth,
          maxWidth,
        };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", stopResizeRef.current);
      },
    [handleMouseMove]
  );

  const resetWidths = useCallback(() => {
    setWidths(defaultWidths);
    if (storageKey && typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // ignore
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- defaultWidths is a stable caller-provided map, not reactive state
  }, [storageKey]);

  return { widths, startResize, resetWidths };
}
