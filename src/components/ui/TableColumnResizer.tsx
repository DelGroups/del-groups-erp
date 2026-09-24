"use client";

import { useEffect } from "react";

/** Width of the grab zone on each header's right edge — matches the `th::after` strip in globals.css. */
const EDGE_PX = 8;
const MIN_COLUMN_PX = 48;

function resizableHeaderAt(e: MouseEvent): HTMLTableCellElement | null {
  const th = e.target;
  // The grab strip is a `::after` pseudo-element, so hits on it report the <th> itself.
  if (!(th instanceof HTMLTableCellElement) || th.tagName !== "TH") return null;
  if (e.clientX < th.getBoundingClientRect().right - EDGE_PX) return null;

  const table = th.closest("table");
  const head = table?.tHead;
  if (!table || !head || th.parentElement?.parentElement !== head) return null;
  // Grids that manage their own widths (useTableResize) or opted out.
  if (table.dataset.colResize === "manual" || table.dataset.colResize === "off") return null;
  // Grouped headers can't be mapped 1:1 onto columns.
  if (head.rows.length !== 1 || Array.from(head.rows[0].cells).some((cell) => cell.colSpan > 1)) return null;
  return th;
}

/**
 * Freezes the table's current auto-layout column widths into explicit pixel
 * widths under `table-layout: fixed`, so one column can then be resized
 * without the browser reflowing the others.
 */
function freezeColumns(table: HTMLTableElement, cells: HTMLTableCellElement[]) {
  if (table.dataset.colResized === "true") return;
  const widths = cells.map((cell) => cell.getBoundingClientRect().width);
  const total = widths.reduce((sum, w) => sum + w, 0);
  const parentWidth = table.parentElement?.clientWidth ?? 0;
  cells.forEach((cell, i) => {
    cell.style.width = `${widths[i]}px`;
  });
  table.style.tableLayout = "fixed";
  table.style.width = `${total}px`;
  // A table that filled its container keeps filling it when the window grows.
  if (total >= parentWidth - 1) table.style.minWidth = "100%";
  table.dataset.colResized = "true";
}

function unfreezeColumns(table: HTMLTableElement, cells: HTMLTableCellElement[]) {
  cells.forEach((cell) => cell.style.removeProperty("width"));
  table.style.removeProperty("table-layout");
  table.style.removeProperty("width");
  table.style.removeProperty("min-width");
  delete table.dataset.colResized;
}

/**
 * Global drag-to-resize for every `<table>` in the ERP. Mounted once in the
 * root layout; uses document-level event delegation, so any grid — Sales,
 * Purchases, Consignments, reports, lists — gets resizable columns with no
 * per-page wiring.
 *
 * Dragging a header's right border moves the border between that column and
 * its neighbour (one grows, the other shrinks, the table width is unchanged),
 * so a full-width table stays full-width. Dragging the last column's border
 * widens the table instead. Double-clicking a border restores auto widths.
 *
 * Opt out with `data-col-resize="off"` on the `<table>`; grids that use
 * `useTableResize` + `<ResizableTh>` mark themselves `data-col-resize="manual"`.
 */
export function TableColumnResizer() {
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const th = resizableHeaderAt(e);
      if (!th) return;
      e.preventDefault();

      const table = th.closest("table") as HTMLTableElement;
      const cells = Array.from((th.parentElement as HTMLTableRowElement).cells);
      freezeColumns(table, cells);

      const index = cells.indexOf(th);
      const neighbor = cells[index + 1] ?? null;
      const startX = e.clientX;
      const startWidth = parseFloat(th.style.width);
      const neighborStart = neighbor ? parseFloat(neighbor.style.width) : 0;
      const othersTotal = cells.reduce((sum, cell) => (cell === th ? sum : sum + parseFloat(cell.style.width)), 0);
      let moved = false;

      const onMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        if (delta !== 0) moved = true;
        if (neighbor) {
          const d = Math.min(neighborStart - MIN_COLUMN_PX, Math.max(MIN_COLUMN_PX - startWidth, delta));
          th.style.width = `${startWidth + d}px`;
          neighbor.style.width = `${neighborStart - d}px`;
        } else {
          const w = Math.max(MIN_COLUMN_PX, startWidth + delta);
          th.style.width = `${w}px`;
          table.style.width = `${othersTotal + w}px`;
        }
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        if (!moved) return;
        // Swallow the click that follows the drag so sortable headers don't re-sort.
        const swallow = (ce: MouseEvent) => {
          ce.stopPropagation();
          ce.preventDefault();
        };
        window.addEventListener("click", swallow, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    };

    const onDoubleClick = (e: MouseEvent) => {
      const th = resizableHeaderAt(e);
      if (!th) return;
      const table = th.closest("table") as HTMLTableElement;
      unfreezeColumns(table, Array.from((th.parentElement as HTMLTableRowElement).cells));
    };

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("dblclick", onDoubleClick);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("dblclick", onDoubleClick);
    };
  }, []);

  return null;
}
