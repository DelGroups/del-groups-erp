"use client";

import React from "react";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, GripVertical, MoreHorizontal, RefreshCw, Settings2, X, type LucideIcon } from "lucide-react";
import { EmptyState, Skeleton } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { MenuItem, MenuLabel, MenuSeparator, ViewMenu } from "@/views/components/Menu";
import { HOME_COLUMNS, type HomeColumn, type WidgetDef, type WidgetSize } from "@/lib/home/registry";

export interface EditControls {
  column: HomeColumn;
  index: number;
  count: number;
  onMove: (column: HomeColumn, index: number) => void;
  onRemove?: () => void;
  onResize: (size: WidgetSize) => void;
  onSettings?: () => void;
  /** Starts a drag from the handle (motion drag controls). */
  onHandlePointerDown: (e: React.PointerEvent) => void;
}

/**
 * The frame of a widget: title, the body, and in edit mode the handle, size picker and the widget
 * menu (Move up / down / to a column, settings, remove) so every move works without a mouse.
 * `bare` widgets bring their own card (FunnelSteps, GoalProgress); the frame only adds the tools.
 */
export function WidgetFrame({
  def,
  size,
  editing,
  controls,
  title,
  action,
  bare,
  children,
}: {
  def: WidgetDef;
  size: WidgetSize;
  editing: boolean;
  controls?: EditControls;
  /** Defaults to the widget's title. */
  title?: string;
  /** Header action outside edit mode (a link, a range picker). */
  action?: React.ReactNode;
  bare?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const name = title ?? t(def.titleKey);
  const headingId = `home-w-${def.id}`;
  const tools = editing && controls ? <EditTools def={def} name={name} size={size} controls={controls} /> : null;

  if (bare) {
    return (
      <section aria-labelledby={editing ? headingId : undefined} className="relative h-full" data-size={size}>
        {tools ? (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-[var(--ds-radius-md)] px-2 py-1" style={{ background: "var(--ds-surface-sunken)" }}>
            <h2 id={headingId} className="truncate text-[length:var(--ds-text-sm)] font-medium">{name}</h2>
            {tools}
          </div>
        ) : null}
        <div className={editing ? "pointer-events-none select-none" : undefined} aria-hidden={editing || undefined}>{children}</div>
      </section>
    );
  }

  return (
    <section aria-labelledby={headingId} className="ds-card flex h-full flex-col" data-size={size} style={editing ? { outline: "1.5px dashed var(--ds-border-strong)", outlineOffset: 2 } : undefined}>
      <header className="flex items-center justify-between gap-2 px-4 pb-1 pt-3">
        <h2 id={headingId} className="truncate text-[length:var(--ds-text-sm)] font-medium ds-muted">{name}</h2>
        {tools ?? action}
      </header>
      <div className={`flex min-h-0 flex-1 flex-col px-4 pb-4 ${editing ? "pointer-events-none select-none" : ""}`} aria-hidden={editing || undefined}>
        {children}
      </div>
    </section>
  );
}

function EditTools({ def, name, size, controls }: { def: WidgetDef; name: string; size: WidgetSize; controls: EditControls }) {
  const { t } = useI18n();
  const { column, index, count } = controls;
  const colIndex = HOME_COLUMNS.indexOf(column);
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        className="ds-btn ds-btn-ghost ds-btn-sm cursor-grab touch-none active:cursor-grabbing"
        aria-label={t("home.edit.dragHandle", { name })}
        onPointerDown={controls.onHandlePointerDown}
      >
        <GripVertical className="h-4 w-4" aria-hidden />
      </button>
      {def.sizes.length > 1 ? (
        <div role="radiogroup" aria-label={t("home.edit.size", { name })} className="inline-flex gap-0.5 p-0.5" style={{ background: "var(--ds-surface-sunken)", borderRadius: "var(--ds-radius-md)" }}>
          {def.sizes.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={s === size}
              aria-label={t(`home.edit.size${s}`)}
              title={t(`home.edit.size${s}`)}
              onClick={() => controls.onResize(s)}
              className="ds-btn ds-btn-sm px-1.5 ds-mono"
              style={s === size ? { background: "var(--ds-surface)", boxShadow: "var(--ds-elevation-1)" } : { background: "transparent", borderColor: "transparent" }}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
      <ViewMenu
        align="end"
        label={name}
        trigger={
          <button type="button" className="ds-btn ds-btn-ghost ds-btn-sm" aria-label={t("home.edit.menu", { name })}>
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </button>
        }
      >
        {index > 0 ? <MenuItem onSelect={() => controls.onMove(column, index - 1)}><ArrowUp className="h-4 w-4" aria-hidden />{t("home.edit.moveUp")}</MenuItem> : null}
        {index < count - 1 ? <MenuItem onSelect={() => controls.onMove(column, index + 1)}><ArrowDown className="h-4 w-4" aria-hidden />{t("home.edit.moveDown")}</MenuItem> : null}
        <MenuSeparator />
        <MenuLabel>{t("home.edit.moveTo")}</MenuLabel>
        {HOME_COLUMNS.map((c, i) =>
          c === column ? null : (
            <MenuItem key={c} onSelect={() => controls.onMove(c, index)}>
              {i < colIndex ? <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden /> : <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden />}
              {t(`home.columns.${c}`)}
            </MenuItem>
          )
        )}
        {controls.onSettings ? (
          <>
            <MenuSeparator />
            <MenuItem onSelect={controls.onSettings}><Settings2 className="h-4 w-4" aria-hidden />{t("home.edit.settings")}</MenuItem>
          </>
        ) : null}
        {controls.onRemove ? (
          <>
            <MenuSeparator />
            <MenuItem danger onSelect={controls.onRemove}><X className="h-4 w-4" aria-hidden />{t("home.edit.remove")}</MenuItem>
          </>
        ) : null}
      </ViewMenu>
      {controls.onRemove ? (
        <button type="button" className="ds-btn ds-btn-ghost ds-btn-sm" aria-label={t("home.edit.removeNamed", { name })} onClick={controls.onRemove}>
          <X className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/** Loading, empty and failed states of a widget body. */
export function WidgetState({
  status,
  empty,
  emptyIcon,
  emptyTitle,
  emptyHint,
  rows = 3,
  onRetry,
  stale,
  children,
}: {
  status: "pending" | "error" | "success";
  empty?: boolean;
  emptyIcon: LucideIcon;
  emptyTitle: string;
  emptyHint?: string;
  rows?: number;
  onRetry?: () => void;
  stale?: string | null;
  children?: React.ReactNode;
}) {
  const { t } = useI18n();
  if (status === "pending") {
    return (
      <div className="flex flex-col gap-2 pt-2" role="status" aria-label={t("common.loading")}>
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-4" style={{ width: `${[78, 56, 68, 44][i % 4]}%` }} />
        ))}
      </div>
    );
  }
  if (status === "error") {
    return (
      <div role="alert" className="flex items-start gap-2 rounded-[var(--ds-radius-md)] p-3 text-[length:var(--ds-text-sm)]" style={{ background: "var(--ds-danger-soft)", color: "var(--ds-danger-strong)" }}>
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="flex flex-1 flex-col gap-1.5">
          <span>{t("home.widgetFailed")}</span>
          {onRetry ? (
            <button type="button" className="ds-btn ds-btn-sm self-start" onClick={onRetry}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              {t("views.retry")}
            </button>
          ) : null}
        </div>
      </div>
    );
  }
  if (empty) return <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyHint} className="gap-2! px-3! py-5!" />;
  return (
    <>
      {children}
      {stale ? <p className="mt-2 text-[length:var(--ds-text-xs)] ds-subtle">{stale}</p> : null}
    </>
  );
}
