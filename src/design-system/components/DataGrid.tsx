"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { motion, useReducedMotion } from "motion/react";
import { ArrowDown, ArrowUp, ChevronRight, Columns3Cog, FileSpreadsheet, Rows3, Rows4 } from "lucide-react";
import {
  ACTIONS_COLUMN_WIDTH,
  GRID_ROW_HEIGHT,
  SELECT_COLUMN_WIDTH,
  distributeSurplus,
  edgeShadows,
  fitWidth,
  floatingScrollbar,
  horizontalWheelDelta,
  nextRowIndex,
  resizeWidth,
  resolveWidths,
  type GridColumnType,
  type GridDensity,
} from "../grid";
import { isTextTruncated } from "../logic";
import { motionPreset, panelVariants } from "../motion";
import { useDesignScope } from "./DesignScope";
import { IconButton } from "./IconButton";
import { Skeleton } from "./Skeleton";
import { Truncate } from "./Truncate";

/*
 * DataGrid (UI-2, docs/ui-standard.md "Lists"): the one list of the system. One-line rows with a
 * fixed height per density, sticky header / first column / actions / totals, resizable columns
 * (hover handle, double-click to fit), its own horizontal scroll with edge shadows and a floating
 * scrollbar, keyboard rows, a toolbar above it. Logical properties only (RTL-safe). Texts come
 * from the caller (labels); widths, order, visibility and density are the caller's prefs.
 */

export interface GridColumn<R> {
  key: string;
  /** Translated header. */
  header: string;
  type?: GridColumnType;
  cell: (row: R) => React.ReactNode;
  sortable?: boolean;
  /** Texts the column shows (status labels, sample amounts) to size it to its content. */
  samples?: readonly string[];
  /** Starting width (px) before the user resizes. */
  width?: number;
  /** Extra classes of the cell content (colour, weight). */
  className?: string;
}

export type GridItem<R> =
  | { kind: "row"; row: R; depth?: number }
  | {
      kind: "group";
      key: string;
      depth: number;
      label: React.ReactNode;
      expanded: boolean;
      onToggle: () => void;
      /** Sums per column key. */
      cells?: Readonly<Record<string, React.ReactNode>>;
    };

export interface GridSelection<R> {
  isSelected: (row: R) => boolean;
  toggle: (row: R) => void;
  allSelected: boolean;
  someSelected: boolean;
  toggleAll: () => void;
}

export interface DataGridLabels {
  columns: string;
  compact: string;
  comfortable: string;
  export: string;
  selectAll: string;
  selectRow: string;
  actions: string;
  /** "Resize column {column}" with {column}. */
  resize: string;
  loading: string;
  total: string;
}

export interface DataGridProps<R> {
  columns: readonly GridColumn<R>[];
  /** Flat rows, or `items` with group rows (the view engine's group by). */
  rows?: readonly R[];
  items?: readonly GridItem<R>[];
  rowKey: (row: R) => string;
  labels: DataGridLabels;
  /** Accessible name of the grid (the list's title). */
  label: string;
  /** User widths (px) by column key. */
  widths?: Readonly<Record<string, number>>;
  /** A width set by dragging or fitting; null resets that column. */
  onWidthChange?: (key: string, width: number | null) => void;
  density?: GridDensity;
  onDensityChange?: (density: GridDensity) => void;
  sort?: { key: string; dir: "asc" | "desc" } | null;
  onSort?: (key: string) => void;
  selection?: GridSelection<R>;
  /** Enter, or a click on the row. */
  onOpen?: (row: R) => void;
  /** The first column becomes a link to it (keyboard, middle-click). */
  rowHref?: (row: R) => string;
  /** Row menu / buttons in the sticky end column. */
  rowActions?: (row: R) => React.ReactNode;
  /** Width of the actions column (px) when a row has several buttons; default one menu button. */
  actionsWidth?: number;
  /** Totals by column key, in a row that sticks to the bottom. */
  totals?: Readonly<Record<string, React.ReactNode>> | null;
  loading?: boolean;
  /** Shown instead of rows when there are none. */
  empty?: React.ReactNode;
  /** Toolbar, start side: search, filters, group by. */
  toolbarStart?: React.ReactNode;
  /** Toolbar: "125 records". */
  count?: string;
  onExport?: () => void;
  /** Content of the "Columns" popover (the column picker). */
  columnsMenu?: React.ReactNode;
  /** Pagination or "load more". */
  footer?: React.ReactNode;
  /** Link component for rowHref (next/link from the app). */
  linkAs?: React.ElementType;
  className?: string;
}

const INTERACTIVE = "a, button, input, select, textarea, label, [role='menu'], [role='menuitem'], [data-grid-stop]";

export function DataGrid<R>(props: DataGridProps<R>) {
  const {
    columns,
    rows,
    items: givenItems,
    rowKey,
    labels,
    label,
    widths: userWidths,
    onWidthChange,
    density = "comfortable",
    onDensityChange,
    sort,
    onSort,
    selection,
    onOpen,
    rowHref,
    rowActions,
    actionsWidth = ACTIONS_COLUMN_WIDTH,
    totals,
    loading,
    empty,
    toolbarStart,
    count,
    onExport,
    columnsMenu,
    footer,
    linkAs: LinkTag = "a",
    className,
  } = props;
  const items = useMemo<readonly GridItem<R>[]>(() => givenItems ?? (rows ?? []).map((row) => ({ kind: "row" as const, row })), [givenItems, rows]);
  const scroller = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLTableElement>(null);
  const floating = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  const [drag, setDrag] = useState<{ key: string; width: number } | null>(null);
  const [shadows, setShadows] = useState({ start: false, end: false });
  const [showFloating, setShowFloating] = useState(false);
  const [scrollWidth, setScrollWidth] = useState(0);
  const [focused, setFocused] = useState(-1);

  const withSelect = !!selection;
  const withActions = !!rowActions;
  const fixed = (withSelect ? SELECT_COLUMN_WIDTH : 0) + (withActions ? actionsWidth : 0);
  const widthCols = useMemo(() => columns.map((c) => ({ key: c.key, type: c.type ?? "text", width: c.width, samples: c.samples, header: c.header })), [columns]);
  const base = useMemo(() => resolveWidths(widthCols, userWidths), [widthCols, userWidths]);
  const widths = useMemo(() => {
    const w = drag ? { ...base, [drag.key]: drag.width } : base;
    return distributeSurplus(widthCols, w, available, fixed);
  }, [base, drag, widthCols, available, fixed]);
  const total = columns.reduce((sum, c) => sum + (widths[c.key] ?? 0), fixed);
  const firstStart = withSelect ? SELECT_COLUMN_WIDTH : 0;
  const rowHeight = GRID_ROW_HEIGHT[density];

  // Width of the box (for the surplus), the edge shadows and the floating scrollbar.
  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setShadows((prev) => {
      const next = edgeShadows(el);
      return prev.start === next.start && prev.end === next.end ? prev : next;
    });
    setScrollWidth(el.scrollWidth);
    setShowFloating(floatingScrollbar(el.getBoundingClientRect(), window.innerHeight, el));
  }, []);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setAvailable(el.clientWidth);
      measure();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);
  useEffect(() => {
    measure();
  }, [measure, total, items.length]);
  useEffect(() => {
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure, { passive: true });
    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  // Shift + wheel scrolls sideways (trackpads scroll sideways on their own).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.shiftKey || e.deltaX !== 0) return;
      const delta = horizontalWheelDelta(e);
      if (!delta || el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      const rtl = getComputedStyle(el).direction === "rtl";
      el.scrollLeft += rtl ? -delta : delta;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // The floating scrollbar and the grid scroll together.
  const syncing = useRef(false);
  const onScroll = () => {
    const el = scroller.current;
    if (el && floating.current && !syncing.current) {
      syncing.current = true;
      floating.current.scrollLeft = el.scrollLeft;
      syncing.current = false;
    }
    measure();
  };
  const onFloatingScroll = () => {
    if (scroller.current && floating.current && !syncing.current) {
      syncing.current = true;
      scroller.current.scrollLeft = floating.current.scrollLeft;
      syncing.current = false;
    }
  };

  // Full text as a tooltip, only on a cell that is really cut.
  const onPointerOver = (e: React.PointerEvent) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>(".ds-grid-cell");
    if (!cell) return;
    if (isTextTruncated(cell)) cell.title = (cell.textContent ?? "").trim();
    else cell.removeAttribute("title");
  };

  // ── Resizing: drag the handle, keyboard arrows, double-click to fit ──
  const startResize = (col: GridColumn<R>) => (e: React.PointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const rtl = getComputedStyle(handle).direction === "rtl";
    const startX = e.clientX;
    const start = widths[col.key];
    const type = col.type ?? "text";
    let last = start;
    const move = (ev: PointerEvent) => {
      last = resizeWidth(type, start, (ev.clientX - startX) * (rtl ? -1 : 1));
      setDrag({ key: col.key, width: last });
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      setDrag(null);
      if (last !== start) onWidthChange?.(col.key, last);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };
  const autoFit = (col: GridColumn<R>) => {
    const el = table.current;
    if (!el) return;
    const cells = [...el.querySelectorAll<HTMLElement>(`td[data-col="${CSS.escape(col.key)}"] .ds-grid-cell`)].map((c) => c.scrollWidth);
    const head = el.querySelector<HTMLElement>(`th[data-col="${CSS.escape(col.key)}"] .ds-grid-head-text`);
    onWidthChange?.(col.key, fitWidth(col.type ?? "text", cells, head?.scrollWidth ?? 0));
  };
  const keyResize = (col: GridColumn<R>) => (e: React.KeyboardEvent<HTMLSpanElement>) => {
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    const step = e.shiftKey ? 48 : 16;
    const grow = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!grow) return;
    e.preventDefault();
    onWidthChange?.(col.key, resizeWidth(col.type ?? "text", widths[col.key], grow * step * (rtl ? -1 : 1)));
  };

  // ── Keyboard: arrows move the focused row, Enter opens, Space selects ──
  const rowEls = useRef(new Map<number, HTMLTableRowElement>());
  const onBodyKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    const next = nextRowIndex(focused, e.key, items.length);
    if (next !== null) {
      e.preventDefault();
      setFocused(next);
      rowEls.current.get(next)?.focus();
      return;
    }
    const item = items[focused];
    if (!item) return;
    if (e.key === "Enter") {
      e.preventDefault();
      if (item.kind === "group") item.onToggle();
      else onOpen?.(item.row);
    } else if (e.key === " " && item.kind === "row" && selection) {
      e.preventDefault();
      selection.toggle(item.row);
    }
  };

  const reduced = useReducedMotion();
  const { portalContainer } = useDesignScope();
  const stickyFirst = (extra = "") => `is-sticky-start is-sticky-last ${extra}`;
  const firstStyle: React.CSSProperties = { insetInlineStart: firstStart };
  const align = (c: GridColumn<R>) => (c.type === "number" || c.type === "money" ? "is-num" : "");

  const headerRow = (
    <tr>
      {withSelect ? (
        <th scope="col" className="ds-grid-select is-sticky-start" style={{ insetInlineStart: 0 }}>
          <SelectBox checked={selection!.allSelected} indeterminate={selection!.someSelected} onChange={selection!.toggleAll} label={labels.selectAll} />
        </th>
      ) : null}
      {columns.map((c, i) => {
        const active = sort?.key === c.key ? sort.dir : null;
        const text = (
          <span className="ds-grid-head-text">
            <Truncate>{c.header}</Truncate>
          </span>
        );
        return (
          <th
            key={c.key}
            scope="col"
            data-col={c.key}
            aria-sort={active === "asc" ? "ascending" : active === "desc" ? "descending" : undefined}
            className={[i === 0 ? stickyFirst() : "", align(c)].join(" ")}
            style={i === 0 ? firstStyle : undefined}
          >
            {c.sortable && onSort ? (
              <button type="button" className="ds-grid-head" onClick={() => onSort(c.key)}>
                {text}
                {active === "asc" ? <ArrowUp className="ds-grid-sort" aria-hidden /> : active === "desc" ? <ArrowDown className="ds-grid-sort" aria-hidden /> : null}
              </button>
            ) : (
              <div className="ds-grid-head">{text}</div>
            )}
            {onWidthChange ? (
              <span
                role="separator"
                aria-orientation="vertical"
                aria-label={labels.resize.replace("{column}", c.header)}
                aria-valuenow={widths[c.key]}
                tabIndex={0}
                className="ds-grid-resize"
                onPointerDown={startResize(c)}
                onDoubleClick={() => autoFit(c)}
                onKeyDown={keyResize(c)}
                onClick={(e) => e.stopPropagation()}
              />
            ) : null}
          </th>
        );
      })}
      {withActions ? (
        <th scope="col" className="ds-grid-actions is-sticky-end">
          <span className="sr-only">{labels.actions}</span>
        </th>
      ) : null}
    </tr>
  );

  const renderRow = (item: Extract<GridItem<R>, { kind: "row" }>, index: number) => {
    const r = item.row;
    const selected = selection?.isSelected(r) ?? false;
    return (
      <tr
        key={rowKey(r)}
        ref={(el) => {
          if (el) rowEls.current.set(index, el);
          else rowEls.current.delete(index);
        }}
        tabIndex={index === focused || (focused < 0 && index === 0) ? 0 : -1}
        aria-selected={selection ? selected : undefined}
        data-selected={selected ? "" : undefined}
        data-clickable={onOpen ? "" : undefined}
        onFocus={() => setFocused(index)}
        onClick={(e) => {
          if (!onOpen || (e.target as HTMLElement).closest(INTERACTIVE)) return;
          onOpen(r);
        }}
      >
        {withSelect ? (
          <td className="ds-grid-select is-sticky-start" style={{ insetInlineStart: 0 }}>
            <SelectBox checked={selected} onChange={() => selection!.toggle(r)} label={labels.selectRow} />
          </td>
        ) : null}
        {columns.map((c, i) => (
          <td key={c.key} data-col={c.key} className={[i === 0 ? stickyFirst() : "", align(c)].join(" ")} style={i === 0 ? firstStyle : undefined}>
            <div
              className={["ds-grid-cell", c.className ?? ""].join(" ")}
              data-ui-truncate=""
              data-ui-check="single-line"
              style={i === 0 && item.depth ? { paddingInlineStart: `${item.depth * 1.25}rem` } : undefined}
            >
              {i === 0 && rowHref ? (
                <LinkTag href={rowHref(r)} className="ds-grid-link">
                  {c.cell(r)}
                </LinkTag>
              ) : (
                c.cell(r)
              )}
            </div>
          </td>
        ))}
        {withActions ? (
          <td className="ds-grid-actions is-sticky-end" data-grid-stop="">
            <div className="ds-grid-actions-inner">{rowActions!(r)}</div>
          </td>
        ) : null}
      </tr>
    );
  };

  const renderGroup = (item: Extract<GridItem<R>, { kind: "group" }>, index: number) => (
    <tr
      key={`group:${item.key}`}
      className="ds-grid-group"
      ref={(el) => {
        if (el) rowEls.current.set(index, el);
        else rowEls.current.delete(index);
      }}
      tabIndex={index === focused || (focused < 0 && index === 0) ? 0 : -1}
      aria-expanded={item.expanded}
      onFocus={() => setFocused(index)}
    >
      {withSelect ? <td className="ds-grid-select is-sticky-start" style={{ insetInlineStart: 0 }} /> : null}
      {columns.map((c, i) =>
        i === 0 ? (
          <th key={c.key} scope="rowgroup" className={stickyFirst()} style={firstStyle}>
            <button type="button" className="ds-grid-group-toggle" aria-expanded={item.expanded} onClick={item.onToggle} style={{ paddingInlineStart: `${item.depth * 1.25}rem` }}>
              <ChevronRight className="ds-grid-chevron" aria-hidden data-open={item.expanded ? "" : undefined} />
              <span className="ds-grid-cell" data-ui-check="single-line" data-ui-truncate="">
                {item.label}
              </span>
            </button>
          </th>
        ) : (
          <td key={c.key} data-col={c.key} className={align(c)}>
            <div className="ds-grid-cell" data-ui-truncate="">
              {item.cells?.[c.key] ?? null}
            </div>
          </td>
        )
      )}
      {withActions ? <td className="ds-grid-actions is-sticky-end" /> : null}
    </tr>
  );

  const colCount = columns.length + (withSelect ? 1 : 0) + (withActions ? 1 : 0);
  const body = loading
    ? Array.from({ length: 8 }, (_, i) => (
        <tr key={`sk${i}`} aria-hidden>
          {withSelect ? <td className="ds-grid-select is-sticky-start" style={{ insetInlineStart: 0 }} /> : null}
          {columns.map((c, j) => (
            <td key={c.key} className={j === 0 ? stickyFirst() : ""} style={j === 0 ? firstStyle : undefined}>
              <Skeleton className="h-3" style={{ width: `${55 + ((i * 7 + j * 13) % 40)}%` }} />
            </td>
          ))}
          {withActions ? <td className="ds-grid-actions is-sticky-end" /> : null}
        </tr>
      ))
    : items.length
      ? items.map((item, i) => (item.kind === "group" ? renderGroup(item, i) : renderRow(item, i)))
      : [
          <tr key="empty" className="ds-grid-empty">
            <td colSpan={colCount}>{empty}</td>
          </tr>,
        ];

  const hasToolbar = toolbarStart || count || onExport || columnsMenu || onDensityChange;
  return (
    <div className={["ds-grid-root", className].filter(Boolean).join(" ")} data-density={density} style={{ ["--ds-grid-row-h" as string]: `${rowHeight}px` }}>
      {hasToolbar ? (
        <div className="ds-grid-toolbar">
          <div className="ds-grid-toolbar-start">
            {toolbarStart}
            {count ? (
              <span className="ds-grid-count" aria-live="polite">
                {count}
              </span>
            ) : null}
          </div>
          <div className="ds-grid-toolbar-end">
            {onDensityChange ? (
              <IconButton
                label={density === "compact" ? labels.comfortable : labels.compact}
                icon={density === "compact" ? <Rows3 className="h-4 w-4" /> : <Rows4 className="h-4 w-4" />}
                onClick={() => onDensityChange(density === "compact" ? "comfortable" : "compact")}
              />
            ) : null}
            {onExport ? <IconButton label={labels.export} icon={<FileSpreadsheet className="h-4 w-4" />} onClick={onExport} /> : null}
            {columnsMenu ? (
              <Popover.Root>
                <Popover.Trigger asChild>
                  <IconButton label={labels.columns} icon={<Columns3Cog className="h-4 w-4" />} />
                </Popover.Trigger>
                <Popover.Portal container={portalContainer ?? undefined}>
                  <Popover.Content align="end" sideOffset={6} collisionPadding={12} className="z-[70] outline-none">
                    <motion.div className="ds-panel w-72 p-3" initial="initial" animate="enter" variants={motionPreset(panelVariants, reduced)}>
                      {columnsMenu}
                    </motion.div>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="ds-grid-frame" data-shadow-start={shadows.start ? "" : undefined} data-shadow-end={shadows.end ? "" : undefined}>
        <div ref={scroller} className="ds-grid-scroll" onScroll={onScroll} role="region" aria-label={label} tabIndex={-1}>
          <table
            ref={table}
            className="ds-grid"
            data-col-resize="manual"
            aria-label={label}
            aria-busy={loading || undefined}
            aria-rowcount={loading ? undefined : items.length + 1}
            style={{ width: total }}
          >
            <colgroup>
              {withSelect ? <col style={{ width: SELECT_COLUMN_WIDTH }} /> : null}
              {columns.map((c) => (
                <col key={c.key} style={{ width: widths[c.key] }} />
              ))}
              {withActions ? <col style={{ width: actionsWidth }} /> : null}
            </colgroup>
            <thead>{headerRow}</thead>
            <tbody onKeyDown={onBodyKeyDown} onPointerOver={onPointerOver}>
              {body}
            </tbody>
            {totals && items.length && !loading ? (
              <tfoot>
                <tr>
                  {withSelect ? <td className="ds-grid-select is-sticky-start" style={{ insetInlineStart: 0 }} /> : null}
                  {columns.map((c, i) => (
                    <td key={c.key} data-col={c.key} className={[i === 0 ? stickyFirst() : "", align(c)].join(" ")} style={i === 0 ? firstStyle : undefined}>
                      <div className="ds-grid-cell" data-ui-truncate="">
                        {i === 0 && totals[c.key] === undefined ? labels.total : totals[c.key] ?? null}
                      </div>
                    </td>
                  ))}
                  {withActions ? <td className="ds-grid-actions is-sticky-end" /> : null}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>
      <div ref={floating} className="ds-grid-hscroll" hidden={!showFloating} onScroll={onFloatingScroll} aria-hidden>
        <div style={{ width: scrollWidth, height: 1 }} />
      </div>
      {footer ? <div className="ds-grid-footer">{footer}</div> : null}
      {loading ? <span className="sr-only" role="status">{labels.loading}</span> : null}
    </div>
  );
}

function SelectBox({ checked, indeterminate, onChange, label }: { checked: boolean; indeterminate?: boolean; onChange: () => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate && !checked;
  }, [indeterminate, checked]);
  return <input ref={ref} type="checkbox" className="ds-grid-checkbox" checked={checked} onChange={onChange} aria-label={label} />;
}
