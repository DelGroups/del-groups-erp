"use client";

import { useId } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Reorder, useDragControls, useReducedMotion } from "motion/react";
import { ArrowDown, ArrowUp, Columns3, GripVertical, Lock, RotateCcw } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { listItemVariants, motionPreset, transitions } from "@/design-system/motion";
import { moveColumn, setColumnOrder, toggleColumn, type ColumnPrefs } from "@/lib/lists/columns";

export interface PickerColumn {
  key: string;
  /** Already translated. */
  label: string;
  defaultVisible: boolean;
  required?: boolean;
}

export interface ColumnPickerProps {
  columns: readonly PickerColumn[];
  prefs: ColumnPrefs;
  onChange: (prefs: ColumnPrefs) => void;
  onReset: () => void;
  /** "classic": the classic app tokens; "ds": the new UI design system. */
  variant?: "classic" | "ds";
  /** New UI: portal inside the design scope so its tokens apply. */
  portalContainer?: HTMLElement | null;
  /** Smaller trigger (the new UI header cell). */
  compact?: boolean;
}

const STYLES = {
  classic: {
    trigger: "btn-ghost text-xs",
    panel: "app-dropdown-panel z-50 w-72 p-3 text-app",
    muted: "text-app-muted",
    row: "hover:bg-app-card-hover",
    icon: "rounded-md p-1 text-app-muted hover:bg-app-card-hover hover:text-app focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--app-accent)] disabled:opacity-30",
    reset: "btn-ghost w-full justify-center text-xs",
    accent: "text-app-accent",
  },
  ds: {
    trigger: "ds-btn ds-btn-sm",
    panel: "ds-panel z-50 w-72 p-3",
    muted: "ds-muted",
    row: "hover:bg-[var(--ds-brand-soft)]",
    icon: "rounded-md p-1 ds-muted hover:bg-[var(--ds-surface-sunken)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--ds-brand)] disabled:opacity-30",
    reset: "ds-btn ds-btn-sm w-full justify-center",
    accent: "",
  },
} as const;

/**
 * "Columns" button of a list (prompt 24c): a checkbox per column, drag handle and Move up /
 * Move down to reorder, and "Reset to default". Required columns cannot be hidden and the
 * last visible column stays. Keyboard: Tab through the rows, Space toggles, the arrow buttons
 * move; motion respects reduced motion. Start/end classes keep it right in RTL.
 */
export function ColumnPicker({ columns, prefs, onChange, onReset, variant = "classic", portalContainer, compact }: ColumnPickerProps) {
  const { t } = useI18n();
  const s = STYLES[variant];
  const reduced = useReducedMotion();
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const order = prefs.order.filter((k) => byKey.has(k));
  const shown = new Set(prefs.visible);
  const shownCount = order.filter((k) => shown.has(k)).length;
  const titleId = useId();

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className={s.trigger} aria-label={t("listColumns.columns")}>
          <Columns3 className={`h-4 w-4 ${s.accent}`} aria-hidden />
          {compact ? null : <span>{t("listColumns.columns")}</span>}
          {compact ? null : <span className={s.muted}>({t("listColumns.shownCount", { shown: shownCount, total: order.length })})</span>}
        </button>
      </Popover.Trigger>
      <Popover.Portal container={portalContainer ?? undefined}>
        <Popover.Content sideOffset={6} align="end" collisionPadding={12} className={s.panel} aria-labelledby={titleId}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p id={titleId} className="text-xs font-semibold">
              {t("listColumns.pickerTitle")}
            </p>
            <span className={`text-xs tabular-nums ${s.muted}`}>{t("listColumns.shownCount", { shown: shownCount, total: order.length })}</span>
          </div>
          <Reorder.Group
            as="ul"
            axis="y"
            values={order}
            onReorder={(next: string[]) => onChange(setColumnOrder(prefs, next))}
            className="max-h-80 space-y-0.5 overflow-y-auto overscroll-contain"
          >
            {order.map((key, index) => {
              const col = byKey.get(key)!;
              return (
                <PickerRow
                  key={key}
                  column={col}
                  checked={shown.has(key)}
                  first={index === 0}
                  last={index === order.length - 1}
                  lastVisible={shown.has(key) && shownCount <= 1}
                  styles={s}
                  reduced={!!reduced}
                  onToggle={() => onChange(toggleColumn(columns, prefs, key))}
                  onMove={(delta) => onChange(moveColumn(prefs, key, delta))}
                />
              );
            })}
          </Reorder.Group>
          <div className="mt-3 border-t pt-3" style={{ borderColor: variant === "ds" ? "var(--ds-border)" : undefined }}>
            <button type="button" className={s.reset} onClick={onReset}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              {t("listColumns.reset")}
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

interface PickerRowProps {
  column: PickerColumn;
  checked: boolean;
  first: boolean;
  last: boolean;
  lastVisible: boolean;
  styles: (typeof STYLES)[keyof typeof STYLES];
  reduced: boolean;
  onToggle: () => void;
  onMove: (delta: -1 | 1) => void;
}

function PickerRow({ column, checked, first, last, lastVisible, styles: s, reduced, onToggle, onMove }: PickerRowProps) {
  const { t } = useI18n();
  const drag = useDragControls();
  const locked = !!column.required || lastVisible;
  const inputId = useId();
  return (
    <Reorder.Item
      as="li"
      value={column.key}
      dragListener={false}
      dragControls={drag}
      variants={motionPreset(listItemVariants, reduced)}
      initial="initial"
      animate="enter"
      transition={reduced ? transitions.instant : transitions.fast}
      className={`flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs ${s.row}`}
    >
      <button
        type="button"
        className={`${s.icon} cursor-grab touch-none active:cursor-grabbing`}
        aria-label={`${t("listColumns.dragHandle")}: ${column.label}`}
        tabIndex={-1}
        onPointerDown={(e) => drag.start(e)}
      >
        <GripVertical className="h-3.5 w-3.5" aria-hidden />
      </button>
      {/* Checkbox and text share one hit target. */}
      <label htmlFor={inputId} className={`flex min-w-0 flex-1 items-center gap-2 text-start ${locked ? "" : "cursor-pointer"}`}>
        <input
          id={inputId}
          type="checkbox"
          checked={checked}
          disabled={locked}
          onChange={onToggle}
          className="rounded border-app text-app-accent focus-visible:ring-2 focus-visible:ring-[color:var(--app-accent-ring)] disabled:opacity-60"
        />
        <span className="min-w-0 truncate">{column.label}</span>
      </label>
      {column.required ? <Lock className={`h-3 w-3 ${s.muted}`} aria-label={t("listColumns.required")} /> : null}
      <button type="button" className={s.icon} disabled={first} onClick={() => onMove(-1)} aria-label={`${t("listColumns.moveUp")}: ${column.label}`}>
        <ArrowUp className="h-3.5 w-3.5" aria-hidden />
      </button>
      <button type="button" className={s.icon} disabled={last} onClick={() => onMove(1)} aria-label={`${t("listColumns.moveDown")}: ${column.label}`}>
        <ArrowDown className="h-3.5 w-3.5" aria-hidden />
      </button>
    </Reorder.Item>
  );
}
