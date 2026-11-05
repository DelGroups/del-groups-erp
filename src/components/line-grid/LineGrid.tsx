"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import { Reorder, useDragControls, useReducedMotion, motion } from "motion/react";
import { ArrowDown, ArrowUp, Columns3Cog, Copy, GripVertical, MoreHorizontal, PanelRightOpen, Plus, Trash2, X } from "lucide-react";
import { IconButton, Truncate, useDesignScope } from "@/design-system/components";
import { ACTIONS_COLUMN_WIDTH, GRID_ROW_HEIGHT, columnAlign, distributeSurplus, edgeShadows, initialColumnWidth, type GridColumnType, type GridDensity } from "@/design-system/grid";
import { isTextTruncated } from "@/design-system/logic";
import { motionPreset, panelVariants } from "@/design-system/motion";
import { LookupScope } from "@/components/lookups/LookupScope";
import { DRAG_COLUMN_WIDTH, focusAfterRemove, lineGridStorageKey, lineKeyAction, moveLine, parseShown, toggleShown, visibleLineColumns } from "./logic";

/*
 * LineGrid (UI-3, docs/ui-standard.md "Line grids"): the one editor of document lines (products,
 * services, costs). Same look as DataGrid: one-line rows of a fixed height, a sticky one-line
 * header, its own horizontal scroll with edge shadows, a sticky first (product) column and a
 * sticky actions column, totals that stick to the bottom. Cells look like text until hovered or
 * focused. Lines are added from the "+ Add a line" row at the bottom (never a box at the top),
 * rarely used fields are optional columns (Columns button) and live in the details drawer.
 * Texts come from the caller (labels); business logic stays in the form.
 */

export interface LineCellContext {
  /** Row index among the lines. */
  index: number;
  /** Accessible name for the cell's control: "Quantity: Product name". */
  label: string;
  /** The column's error for this line (red outline + tooltip, never an extra line). */
  error?: string;
  invalid: boolean;
  editable: boolean;
  /** true when the cell is rendered as a field in the details drawer. */
  inDrawer: boolean;
  /** Opens this line's details drawer (e.g. a computed quantity set from its details). */
  openDetails?: () => void;
}

export interface LineColumn<L> {
  key: string;
  /** Translated header (one line, ellipsis + tooltip). */
  header: string;
  /** Width class: number / money are right aligned with tabular figures; text takes the free space. */
  type?: GridColumnType;
  /** Starting width (px). */
  width?: number;
  /** Hidden until the user shows it (Columns button); always editable in the details drawer. */
  optional?: boolean;
  /** Tooltip of the header (what the column means). */
  hint?: string;
  cell: (line: L, ctx: LineCellContext) => React.ReactNode;
  /** Validation message for the line, shown as a red outline and a tooltip. */
  error?: (line: L) => string | null | undefined;
  /** A softer note for the cell (missing data the line still works without): amber outline + tooltip. */
  warning?: (line: L) => string | null | undefined;
  /** Footer total under this column. */
  total?: React.ReactNode;
}

export interface LineGridLabels {
  addLine: string;
  /** "Ctrl+Enter" hint next to the add button. */
  addLineShortcut: string;
  empty: string;
  columns: string;
  optionalColumns: string;
  actions: string;
  rowActions: string;
  duplicate: string;
  remove: string;
  details: string;
  moveUp: string;
  moveDown: string;
  drag: string;
  total: string;
  cancel: string;
  close: string;
}

/** An extra item of a line's "…" menu. */
export interface LineMenuItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}

export interface LineGridProps<L> {
  /** Stable id of the grid (shown optional columns are kept per user under it). */
  id: string;
  /** Accessible name (the section title). */
  label: string;
  lines: readonly L[];
  lineKey: (line: L) => string;
  /** Short name of a line for accessible labels and the drawer title (the product name). */
  lineLabel?: (line: L, index: number) => string;
  columns: readonly LineColumn<L>[];
  labels: LineGridLabels;
  editable?: boolean;
  /** "Add a line" appends an empty line; the grid focuses its first cell. */
  onAddLine?: () => void;
  /**
   * Product-first documents: "Add a line" opens a new row with only this cell (a product search
   * that opens on its own); call done() once the line is added or the user gives up.
   */
  newLineCell?: (done: () => void) => React.ReactNode;
  onRemove?: (index: number) => void;
  onDuplicate?: (index: number) => void;
  /** Drag handle + move up / down: the new order of line keys. */
  onReorder?: (keys: string[]) => void;
  /** Extra fields of a line in the details drawer (after the optional columns). */
  details?: (line: L, index: number) => React.ReactNode;
  /** More actions in the add row (e.g. "Pick several products"). */
  addActions?: React.ReactNode;
  /**
   * "Add a line" opens a menu of these choices (cost types) instead of adding at once; the
   * caller adds the line for the picked key.
   */
  addMenu?: readonly { key: string; label: string }[];
  onAddFrom?: (key: string) => void;
  /** Extra items of a row's "…" menu, before Duplicate (e.g. "Split across warehouses"). */
  rowMenuItems?: (line: L, index: number) => readonly LineMenuItem[];
  /** A line that cannot be changed (a posted cost): its cells read only, no Duplicate / Remove. */
  rowEditable?: (line: L, index: number) => boolean;
  /** Optional columns shown whatever the user chose (data a split method needs). */
  forceShown?: readonly string[];
  density?: GridDensity;
  className?: string;
  /**
   * false: the caller already gives a design scope with its own theme (the UI lab). By default
   * the grid opens one that follows the classic theme, like a lookup in a classic form.
   */
  scoped?: boolean;
}

// Shown optional columns: localStorage, with this tab's copy when storage is refused.
const shownMemory = new Map<string, string>();
const shownListeners = new Set<() => void>();
function readShown(key: string): string | null {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored !== null) return stored;
  } catch {
    // Storage blocked: this tab's copy.
  }
  return shownMemory.get(key) ?? null;
}
function writeShown(key: string, value: string) {
  shownMemory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Blocked storage: the choice lasts until the page is left.
  }
  for (const fn of shownListeners) fn();
}
function subscribeShown(fn: () => void) {
  shownListeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    shownListeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}

const FOCUSABLE = "input:not([disabled]):not([type='checkbox']), textarea:not([disabled]), button[role='combobox']:not([disabled]), [data-line-focus]";

export function LineGrid<L>(props: LineGridProps<L>) {
  if (props.scoped === false) return <LineGridInner {...props} />;
  return (
    <LookupScope>
      <LineGridInner {...props} />
    </LookupScope>
  );
}

function LineGridInner<L>({
  id,
  label,
  lines,
  lineKey,
  lineLabel,
  columns,
  labels,
  editable = true,
  onAddLine,
  newLineCell,
  onRemove,
  onDuplicate,
  onReorder,
  details,
  addActions,
  addMenu,
  onAddFrom,
  rowMenuItems,
  rowEditable,
  forceShown,
  density = "compact",
  className,
}: LineGridProps<L>) {
  const [adding, setAdding] = useState(false);
  const [drawer, setDrawer] = useState<string | null>(null);
  const [available, setAvailable] = useState(0);
  const [shadows, setShadows] = useState({ start: false, end: false });
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLTableSectionElement>(null);
  const pendingFocus = useRef<{ row: number | "last"; col: number } | null>(null);
  const reduced = useReducedMotion();
  const { portalContainer } = useDesignScope();

  // The user's optional columns, per grid (a convenience: storage may be blocked). The server
  // render and the first client render show none, so hydration matches.
  const storageKey = lineGridStorageKey(id);
  const rawShown = useSyncExternalStore(subscribeShown, () => readShown(storageKey), () => null);
  const userShown = useMemo(() => parseShown(rawShown), [rawShown]);
  const forcedKey = (forceShown ?? []).join("|");
  const shown = useMemo(() => {
    if (!forcedKey) return userShown;
    const next = new Set(userShown);
    for (const k of forcedKey.split("|")) next.add(k);
    return next;
  }, [userShown, forcedKey]);
  const toggleColumn = (key: string) => writeShown(storageKey, JSON.stringify([...toggleShown(userShown, key)]));
  const forced = new Set(forceShown ?? []);

  const visible = useMemo(() => visibleLineColumns(columns, shown), [columns, shown]);
  const optional = columns.filter((c) => c.optional);
  const reorder = editable && !!onReorder;
  const withActions = editable || optional.length > 0 || !!details;
  const fixed = (withActions ? ACTIONS_COLUMN_WIDTH : 0) + (reorder ? DRAG_COLUMN_WIDTH : 0);
  const widthCols = useMemo(() => visible.map((c) => ({ key: c.key, type: c.type ?? "text", width: c.width, header: c.header })), [visible]);
  const widths = useMemo(() => {
    const base: Record<string, number> = {};
    for (const c of widthCols) base[c.key] = initialColumnWidth(c);
    return distributeSurplus(widthCols, base, available, fixed);
  }, [widthCols, available, fixed]);
  const tableWidth = visible.reduce((sum, c) => sum + (widths[c.key] ?? 0), fixed);
  const rowHeight = GRID_ROW_HEIGHT[density];
  const hasTotals = visible.some((c) => c.total !== undefined);
  const colCount = visible.length + (withActions ? 1 : 0) + (reorder ? 1 : 0);
  const keys = useMemo(() => lines.map(lineKey), [lines, lineKey]);

  const measure = () => {
    const el = scroller.current;
    if (!el) return;
    setShadows((prev) => {
      const next = edgeShadows(el);
      return prev.start === next.start && prev.end === next.end ? prev : next;
    });
  };
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setAvailable(el.clientWidth);
      measure();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(measure, [tableWidth, lines.length]);

  // ── Focus ──
  const focusCell = (row: number, col: number) => {
    const tr = body.current?.querySelector<HTMLElement>(`tr[data-line-row="${row}"]`);
    if (!tr) return false;
    const td = tr.querySelector<HTMLElement>(`td[data-line-col="${col}"]`);
    const target = td?.querySelector<HTMLElement>(FOCUSABLE) ?? tr.querySelector<HTMLElement>(FOCUSABLE);
    if (!target) return false;
    target.focus();
    if (target instanceof HTMLInputElement) target.select();
    return true;
  };
  useEffect(() => {
    const want = pendingFocus.current;
    if (!want) return;
    pendingFocus.current = null;
    // After the browser has laid the new row out (and the drag layer has measured it).
    const row = want.row === "last" ? lines.length - 1 : want.row;
    requestAnimationFrame(() => focusCell(row, want.col));
  });

  const add = () => {
    if (!editable) return;
    if (newLineCell) {
      setAdding(true);
      return;
    }
    if (!onAddLine) return;
    pendingFocus.current = { row: "last", col: 0 };
    onAddLine();
  };
  const remove = (index: number) => {
    if (!onRemove) return;
    const next = focusAfterRemove(index, lines.length - 1);
    if (next !== null) pendingFocus.current = { row: next, col: 0 };
    onRemove(index);
  };
  const move = (index: number, to: number) => {
    if (!onReorder) return;
    onReorder(moveLine(keys, index, to));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const tr = target.closest<HTMLElement>("tr[data-line-row]");
    const td = target.closest<HTMLElement>("td[data-line-col]");
    if (!editable) return;
    // Ctrl+Enter adds a line from anywhere in the grid.
    if (!tr || !td) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        add();
      }
      return;
    }
    // Plain Enter belongs to buttons and lookups (they open); it moves down only from inputs.
    const inInput = target instanceof HTMLInputElement;
    if (e.key === "Enter" && !inInput && !(e.ctrlKey || e.metaKey)) return;
    const at = { row: Number(tr.dataset.lineRow), col: Number(td.dataset.lineCol) };
    const action = lineKeyAction(e, at, lines.length);
    if (!action) return;
    e.preventDefault();
    if (action.type === "focus") focusCell(action.row, action.col);
    else if (action.type === "add") {
      if (!newLineCell) pendingFocus.current = { row: "last", col: at.col };
      add();
    } else if (action.type === "remove") remove(action.row);
  };

  // Full text as a tooltip, only on read-only text that is really cut.
  const onPointerOver = (e: React.PointerEvent) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>(".ds-line-text");
    if (!cell) return;
    if (isTextTruncated(cell)) cell.title = (cell.textContent ?? "").trim();
    else cell.removeAttribute("title");
  };

  const nameOf = (line: L, index: number) => lineLabel?.(line, index) || String(index + 1);
  const ctxFor = (line: L, index: number, col: LineColumn<L>, inDrawer: boolean): LineCellContext => {
    const error = col.error?.(line) || undefined;
    const key = keys[index];
    return {
      index,
      label: `${col.header}: ${nameOf(line, index)}`,
      error,
      invalid: !!error,
      editable: editable && (rowEditable ? rowEditable(line, index) : true),
      inDrawer,
      openDetails: inDrawer || !(optional.length || details) ? undefined : () => setDrawer(key),
    };
  };

  const header = (
    <tr>
      {reorder ? <th scope="col" className="ds-line-drag" aria-hidden /> : null}
      {visible.map((c, i) => (
        <th
          key={c.key}
          scope="col"
          className={[i === 0 ? "is-sticky-start is-sticky-last" : "", isNum(c) ? "is-num" : ""].join(" ")}
          style={i === 0 ? { insetInlineStart: reorder ? DRAG_COLUMN_WIDTH : 0 } : undefined}
        >
          <div className="ds-grid-head" title={c.hint}>
            <span className="ds-grid-head-text">
              <Truncate>{c.header}</Truncate>
            </span>
          </div>
        </th>
      ))}
      {withActions ? (
        <th scope="col" className="ds-grid-actions is-sticky-end">
          {optional.length ? (
            <Popover.Root>
              <Popover.Trigger asChild>
                <IconButton size="sm" label={labels.columns} icon={<Columns3Cog className="h-4 w-4" />} tabIndex={-1} />
              </Popover.Trigger>
              <Popover.Portal container={portalContainer ?? undefined}>
                <Popover.Content align="end" sideOffset={6} collisionPadding={12} className="z-[var(--ds-z-dropdown)] outline-none">
                  <motion.div className="ds-panel w-64 p-2" initial="initial" animate="enter" variants={motionPreset(panelVariants, reduced)}>
                    <p className="px-2 pb-1 text-[length:var(--ds-text-xs)] font-semibold ds-muted">{labels.optionalColumns}</p>
                    {optional.map((c) => (
                      <label key={c.key} className="ds-menu-item">
                        <input type="checkbox" className="ds-grid-checkbox" checked={shown.has(c.key)} disabled={forced.has(c.key)} onChange={() => toggleColumn(c.key)} />
                        <Truncate>{c.header}</Truncate>
                      </label>
                    ))}
                  </motion.div>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          ) : (
            <span className="sr-only">{labels.actions}</span>
          )}
        </th>
      ) : null}
    </tr>
  );

  const rows = lines.map((line, index) => (
    <LineRow
      key={keys[index]}
      value={keys[index]}
      index={index}
      reorder={reorder}
      dragLabel={labels.drag}
    >
      {visible.map((c, i) => {
        const ctx = ctxFor(line, index, c, false);
        return (
          <td
            key={c.key}
            data-line-col={i}
            data-invalid={ctx.invalid ? "" : undefined}
            data-warning={!ctx.invalid && c.warning?.(line) ? "" : undefined}
            title={ctx.error ?? c.warning?.(line) ?? undefined}
            className={[i === 0 ? "is-sticky-start is-sticky-last" : "", isNum(c) ? "is-num" : ""].join(" ")}
            style={i === 0 ? { insetInlineStart: reorder ? DRAG_COLUMN_WIDTH : 0 } : undefined}
          >
            {c.cell(line, ctx)}
          </td>
        );
      })}
      {withActions ? (
        <td className="ds-grid-actions is-sticky-end">
          <div className="ds-grid-actions-inner">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <IconButton size="sm" label={`${labels.rowActions}: ${nameOf(line, index)}`} icon={<MoreHorizontal className="h-4 w-4" />} tabIndex={-1} />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal container={portalContainer ?? undefined}>
                <DropdownMenu.Content align="end" sideOffset={4} collisionPadding={12} className="ds-menu">
                  {optional.length || details ? (
                    <DropdownMenu.Item className="ds-menu-item" onSelect={() => setDrawer(keys[index])}>
                      <PanelRightOpen className="h-4 w-4" aria-hidden />
                      {labels.details}
                    </DropdownMenu.Item>
                  ) : null}
                  {(rowMenuItems?.(line, index) ?? []).map((item) => (
                    <DropdownMenu.Item key={item.key} className="ds-menu-item" disabled={item.disabled} onSelect={() => item.onSelect()}>
                      {item.icon}
                      {item.label}
                    </DropdownMenu.Item>
                  ))}
                  {editable && onDuplicate && (rowEditable ? rowEditable(line, index) : true) ? (
                    <DropdownMenu.Item className="ds-menu-item" onSelect={() => onDuplicate(index)}>
                      <Copy className="h-4 w-4" aria-hidden />
                      {labels.duplicate}
                    </DropdownMenu.Item>
                  ) : null}
                  {reorder ? (
                    <>
                      <DropdownMenu.Item className="ds-menu-item" disabled={index === 0} onSelect={() => move(index, index - 1)}>
                        <ArrowUp className="h-4 w-4" aria-hidden />
                        {labels.moveUp}
                      </DropdownMenu.Item>
                      <DropdownMenu.Item className="ds-menu-item" disabled={index === lines.length - 1} onSelect={() => move(index, index + 1)}>
                        <ArrowDown className="h-4 w-4" aria-hidden />
                        {labels.moveDown}
                      </DropdownMenu.Item>
                    </>
                  ) : null}
                  {editable && onRemove && (rowEditable ? rowEditable(line, index) : true) ? (
                    <>
                      <DropdownMenu.Separator className="ds-menu-sep" />
                      <DropdownMenu.Item className="ds-menu-item ds-line-danger" onSelect={() => remove(index)}>
                        <Trash2 className="h-4 w-4" aria-hidden />
                        {labels.remove}
                      </DropdownMenu.Item>
                    </>
                  ) : null}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </td>
      ) : null}
    </LineRow>
  ));

  const pendingRow =
    adding && newLineCell ? (
      <tr className="ds-line-pending">
        {reorder ? <td className="ds-line-drag" /> : null}
        <td className="is-sticky-start is-sticky-last" style={{ insetInlineStart: reorder ? DRAG_COLUMN_WIDTH : 0 }} data-line-col={0}>
          {newLineCell(() => setAdding(false))}
        </td>
        {visible.slice(1).map((c) => (
          <td key={c.key} />
        ))}
        {withActions ? (
          <td className="ds-grid-actions is-sticky-end">
            <div className="ds-grid-actions-inner">
              <IconButton size="sm" label={labels.cancel} icon={<X className="h-4 w-4" />} onClick={() => setAdding(false)} />
            </div>
          </td>
        ) : null}
      </tr>
    ) : null;

  const addRow = editable && (onAddLine || newLineCell || (addMenu?.length && onAddFrom)) ? (
    <tr className="ds-line-add">
      <td colSpan={colCount}>
        <div className="ds-line-add-inner">
          {addMenu?.length && onAddFrom ? (
            // A menu of what to add (cost types); the caller adds the line for the choice.
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button type="button" className="ds-line-add-btn" aria-haspopup="menu">
                  <Plus className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="truncate">{labels.addLine}</span>
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal container={portalContainer ?? undefined}>
                <DropdownMenu.Content align="start" side="top" sideOffset={4} collisionPadding={12} className="ds-menu min-w-56">
                  {addMenu.map((m) => (
                    <DropdownMenu.Item key={m.key} className="ds-menu-item" onSelect={() => onAddFrom(m.key)}>
                      {m.label}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          ) : (
            <button type="button" className="ds-line-add-btn" onClick={add} disabled={adding}>
              <Plus className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">{labels.addLine}</span>
            </button>
          )}
          {addActions}
          <span className="ds-line-add-hint" aria-hidden>
            {lines.length === 0 && !adding ? <span className="truncate">{labels.empty}</span> : null}
            <kbd className="ds-line-kbd">{labels.addLineShortcut}</kbd>
          </span>
        </div>
      </td>
    </tr>
  ) : lines.length === 0 ? (
    <tr className="ds-grid-empty">
      <td colSpan={colCount}>{labels.empty}</td>
    </tr>
  ) : null;

  const drawerIndex = drawer ? keys.indexOf(drawer) : -1;
  const drawerLine = drawerIndex >= 0 ? lines[drawerIndex] : null;

  return (
    <div className={["ds-grid-root ds-line-grid", className].filter(Boolean).join(" ")} data-density={density} style={{ ["--ds-grid-row-h" as string]: `${rowHeight}px` }}>
      <div className="ds-grid-frame" data-shadow-start={shadows.start ? "" : undefined} data-shadow-end={shadows.end ? "" : undefined}>
        <div ref={scroller} className="ds-grid-scroll" onScroll={measure} role="region" aria-label={label} tabIndex={-1}>
          <table className="ds-grid" data-col-resize="manual" aria-label={label} style={{ width: tableWidth }} onKeyDown={onKeyDown}>
            <colgroup>
              {reorder ? <col style={{ width: DRAG_COLUMN_WIDTH }} /> : null}
              {visible.map((c) => (
                <col key={c.key} style={{ width: widths[c.key] }} />
              ))}
              {withActions ? <col style={{ width: ACTIONS_COLUMN_WIDTH }} /> : null}
            </colgroup>
            <thead>{header}</thead>
            {reorder ? (
              <Reorder.Group as="tbody" axis="y" values={keys} onReorder={(next: string[]) => onReorder?.(next)} ref={body} onPointerOver={onPointerOver}>
                {rows}
                {pendingRow}
                {addRow}
              </Reorder.Group>
            ) : (
              <tbody ref={body} onPointerOver={onPointerOver}>
                {rows}
                {pendingRow}
                {addRow}
              </tbody>
            )}
            {hasTotals && lines.length ? (
              <tfoot>
                <tr>
                  {reorder ? <td className="ds-line-drag" /> : null}
                  {visible.map((c, i) => (
                    <td
                      key={c.key}
                      className={[i === 0 ? "is-sticky-start is-sticky-last" : "", isNum(c) ? "is-num" : ""].join(" ")}
                      style={i === 0 ? { insetInlineStart: reorder ? DRAG_COLUMN_WIDTH : 0 } : undefined}
                    >
                      <div className="ds-grid-cell" data-ui-truncate="" data-ui-check="single-line">
                        {i === 0 && c.total === undefined ? labels.total : c.total ?? null}
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

      <Dialog.Root open={drawerLine !== null} onOpenChange={(open) => !open && setDrawer(null)}>
        <Dialog.Portal container={portalContainer ?? undefined}>
          <Dialog.Overlay className="ds-overlay ds-line-drawer-overlay" />
          <Dialog.Content className="ds-panel ds-line-drawer" aria-describedby={undefined}>
            {drawerLine !== null ? (
              <>
                <div className="ds-line-drawer-head">
                  <Dialog.Title className="min-w-0 font-semibold">
                    <Truncate>{nameOf(drawerLine, drawerIndex)}</Truncate>
                  </Dialog.Title>
                  <Dialog.Close asChild>
                    <IconButton size="sm" label={labels.close} icon={<X className="h-4 w-4" />} />
                  </Dialog.Close>
                </div>
                <div className="ds-line-drawer-body">
                  {optional.map((c) => {
                    const ctx = ctxFor(drawerLine, drawerIndex, c, true);
                    return (
                      <div key={c.key} className="ds-field" data-layout="stacked" data-invalid={ctx.invalid ? "" : undefined}>
                        <div className="ds-field-label">
                          <Truncate>{c.header}</Truncate>
                        </div>
                        <div className="ds-field-control ds-line-drawer-control" title={ctx.error}>
                          {c.cell(drawerLine, ctx)}
                        </div>
                      </div>
                    );
                  })}
                  {details?.(drawerLine, drawerIndex)}
                </div>
              </>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

/** End-aligned column: the one alignment rule of every grid (grid.ts columnAlign, UI-5). */
function isNum<L>(c: LineColumn<L>) {
  return columnAlign(c.type) === "end";
}

/** One line: a plain row, or a draggable one (motion Reorder) with a handle in the first column. */
function LineRow({ value, index, reorder, dragLabel, children }: { value: string; index: number; reorder: boolean; dragLabel: string; children: React.ReactNode }) {
  const controls = useDragControls();
  if (!reorder) {
    return (
      <tr data-line-row={index} data-line-key={value}>
        {children}
      </tr>
    );
  }
  return (
    <Reorder.Item as="tr" value={value} dragListener={false} dragControls={controls} data-line-row={index} data-line-key={value} layout="position">
      <td className="ds-line-drag">
        <span
          className="ds-line-drag-handle"
          role="img"
          aria-label={dragLabel}
          title={dragLabel}
          onPointerDown={(e) => {
            e.preventDefault();
            controls.start(e);
          }}
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </span>
      </td>
      {children}
    </Reorder.Item>
  );
}
