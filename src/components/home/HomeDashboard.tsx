"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { MotionConfig, Reorder, motion, useDragControls, useReducedMotion } from "motion/react";
import { Building2, Check, LayoutGrid, Plus, RotateCcw, Settings2, X } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import { DesignScope, ToastProvider, useDesignScope, useToast } from "@/design-system/components";
import { motionPreset, overlayVariants } from "@/design-system/motion";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { useNewUi } from "@/components/shell/NewUiProvider";
import {
  addable,
  addWidget,
  findWidget,
  moveWidget,
  readingOrder,
  removeWidget,
  resizeWidget,
  sameLayout,
  setWidgetSettings,
  type HomeLayout,
  type WidgetPlacement,
} from "@/lib/home/layout";
import { HOME_COLUMNS, WIDGET_CATEGORIES, widgetDef, type HomeColumn, type WidgetDef } from "@/lib/home/registry";
import { cleanCity } from "@/lib/home/weather";
import { WIDGET_COMPONENTS } from "./widgets";
import { useHomeLayout } from "./useHomeLayout";

/** The widget home page (prompt 24b, NEW_HOME): full width, three columns, customisable. */
export default function HomeDashboard() {
  const { theme } = useTheme();
  const { brand } = useNewUi();
  const { t } = useI18n();
  return (
    <PageLayout permission={null}>
      <DesignScope theme={theme === "daylight" ? "light" : "dark"} brand={brand} className="w-full rounded-[var(--ds-radius-xl)] p-3 md:p-5">
        <ToastProvider closeLabel={t("common.close")}>
          <MotionConfig reducedMotion="user">
            <Home />
          </MotionConfig>
        </ToastProvider>
      </DesignScope>
    </PageLayout>
  );
}

const COLUMN_CLASS: Record<HomeColumn, string> = {
  // md: the centre (apps) spans both columns on top; xl: start 3/12, centre 6/12, end 3/12.
  start: "xl:col-span-3 xl:order-1",
  centre: "md:col-span-2 md:order-first xl:col-span-6 xl:order-2",
  end: "xl:col-span-3 xl:order-3",
};

function Home() {
  const { t } = useI18n();
  const { toast } = useToast();
  const home = useHomeLayout();
  const [draft, setDraft] = useState<HomeLayout | null>(null);
  const [adding, setAdding] = useState(false);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const editing = draft !== null;
  const layout = draft ?? home.layout;
  const name = (id: string) => t(widgetDef(id)?.titleKey ?? id);

  const update = (next: HomeLayout, message?: string) => {
    if (editing) setDraft(next);
    else void home.save.mutateAsync(next).catch(() => toast(t("home.edit.saveFailed"), undefined, "error"));
    if (message) setAnnounce(message);
  };

  const moveTo = (id: string, column: HomeColumn, index: number) => {
    const next = moveWidget(layout, id, column, index);
    const at = findWidget(next, id);
    update(next, at ? t("home.edit.moved", { name: name(id), column: t(`home.columns.${at.column}`), position: at.index + 1 }) : undefined);
  };

  const save = async () => {
    if (!draft) return;
    try {
      await home.save.mutateAsync(draft);
      setDraft(null);
      toast(t("home.edit.saved"), undefined, "success");
    } catch {
      toast(t("home.edit.saveFailed"), undefined, "error");
    }
  };

  const saveCompany = async () => {
    if (!draft) return;
    try {
      await home.saveCompanyDefault.mutateAsync(draft);
      toast(t("home.edit.companySaved"), undefined, "success");
    } catch {
      toast(t("home.edit.saveFailed"), undefined, "error");
    }
  };

  const resetToDefault = () => {
    setDraft(home.defaultLayout);
    setAnnounce(t("home.edit.resetDone"));
  };

  // Escape leaves edit mode without saving.
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !adding && !settingsFor && !document.querySelector("[data-radix-menu-content]")) setDraft(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, adding, settingsFor]);

  if (!home.ready) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-12" aria-busy>
        {HOME_COLUMNS.map((c) => (
          <div key={c} className={`flex flex-col gap-3 ${COLUMN_CLASS[c]}`}>
            {[0, 1, 2].map((i) => <div key={i} className="ds-card ds-skeleton h-36" />)}
          </div>
        ))}
      </div>
    );
  }

  const dirty = editing && !sameLayout(draft, home.layout);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {editing ? (
          <>
            <p className="me-auto ds-muted" role="status">{t("home.edit.hint")}</p>
            <button type="button" className="ds-btn ds-btn-sm" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              {t("home.edit.add")}
            </button>
            <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={resetToDefault}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              {t("home.edit.reset")}
            </button>
            {home.isAdmin ? (
              <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={() => void saveCompany()} disabled={home.saveCompanyDefault.isPending}>
                <Building2 className="h-4 w-4" aria-hidden />
                {t("home.edit.saveCompany")}
              </button>
            ) : null}
            <button type="button" className="ds-btn ds-btn-sm" onClick={() => setDraft(null)}>{t("common.cancel")}</button>
            <button type="button" className="ds-btn ds-btn-sm ds-btn-primary" onClick={() => void save()} disabled={!dirty || home.save.isPending}>
              <Check className="h-4 w-4" aria-hidden />
              {t("common.save")}
            </button>
          </>
        ) : (
          <button type="button" className="ds-btn ds-btn-sm" onClick={() => setDraft(home.layout)}>
            <LayoutGrid className="h-4 w-4" aria-hidden />
            {t("home.edit.customise")}
          </button>
        )}
      </div>

      <p className="sr-only" aria-live="polite">{announce}</p>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-12">
        {HOME_COLUMNS.map((column) => (
          <ColumnView
            key={column}
            column={column}
            items={layout.columns[column]}
            layout={layout}
            editing={editing}
            onReorder={(items) => setDraft({ ...layout, columns: { ...layout.columns, [column]: items } })}
            onMove={moveTo}
            onRemove={(id) => update(removeWidget(layout, id), t("home.edit.removed", { name: name(id) }))}
            onResize={(id, size) => update(resizeWidget(layout, id, size), t("home.edit.resized", { name: name(id), size: t(`home.edit.size${size}`) }))}
            onSettings={(id) => setSettingsFor(id)}
            setSettings={(id, s) => update(setWidgetSettings(layout, id, s))}
          />
        ))}
      </div>

      <AddWidgetSheet
        open={adding}
        onOpenChange={setAdding}
        options={addable(layout, home.ctx)}
        onAdd={(id) => {
          update(addWidget(layout, id, home.ctx), t("home.edit.added", { name: name(id) }));
        }}
      />
      <WidgetSettingsDialog
        id={settingsFor}
        placement={settingsFor ? readingOrder(layout).find((p) => p.id === settingsFor) ?? null : null}
        onClose={() => setSettingsFor(null)}
        onSave={(id, s) => {
          update(setWidgetSettings(layout, id, s));
          setSettingsFor(null);
        }}
      />
    </div>
  );
}

/** Widgets with settings (see WidgetSettingsDialog). */
const HAS_SETTINGS = new Set(["weather", "clock"]);

function ColumnView({
  column,
  items,
  layout,
  editing,
  onReorder,
  onMove,
  onRemove,
  onResize,
  onSettings,
  setSettings,
}: {
  column: HomeColumn;
  items: WidgetPlacement[];
  layout: HomeLayout;
  editing: boolean;
  onReorder: (items: WidgetPlacement[]) => void;
  onMove: (id: string, column: HomeColumn, index: number) => void;
  onRemove: (id: string) => void;
  onResize: (id: string, size: WidgetPlacement["size"]) => void;
  onSettings: (id: string) => void;
  setSettings: (id: string, s: Record<string, string>) => void;
}) {
  const { t } = useI18n();
  return (
    <section aria-label={t(`home.columns.${column}`)} className={`flex min-w-0 flex-col ${COLUMN_CLASS[column]}`} data-home-column={column}>
      <Reorder.Group
        axis="y"
        values={items}
        onReorder={onReorder}
        as="ul"
        className="grid min-h-16 grid-cols-2 content-start gap-3"
        style={editing ? { outline: "1.5px dashed var(--ds-border)", outlineOffset: 6, borderRadius: "var(--ds-radius-lg)" } : undefined}
      >
        {items.map((p, index) => (
          <WidgetItem
            key={p.id}
            placement={p}
            column={column}
            index={index}
            count={items.length}
            layout={layout}
            editing={editing}
            onMove={onMove}
            onRemove={onRemove}
            onResize={onResize}
            onSettings={onSettings}
            setSettings={setSettings}
          />
        ))}
        {editing && !items.length ? <li className="col-span-2 grid h-16 place-items-center text-[length:var(--ds-text-sm)] ds-subtle">{t("home.edit.dropHere")}</li> : null}
      </Reorder.Group>
    </section>
  );
}

/** Where a drag ended: the column under the pointer and the position among its widgets. */
function dropTarget(x: number, y: number): { column: HomeColumn; index: number } | null {
  const el = document.elementFromPoint(x, y)?.closest("[data-home-column]") as HTMLElement | null;
  const column = el?.dataset.homeColumn as HomeColumn | undefined;
  if (!el || !column) return null;
  const cards = [...el.querySelectorAll<HTMLElement>("[data-home-widget]")];
  const index = cards.filter((c) => {
    const r = c.getBoundingClientRect();
    return r.top + r.height / 2 < y;
  }).length;
  return { column, index };
}

function WidgetItem({
  placement,
  column,
  index,
  count,
  editing,
  onMove,
  onRemove,
  onResize,
  onSettings,
  setSettings,
}: {
  placement: WidgetPlacement;
  column: HomeColumn;
  index: number;
  count: number;
  layout: HomeLayout;
  editing: boolean;
  onMove: (id: string, column: HomeColumn, index: number) => void;
  onRemove: (id: string) => void;
  onResize: (id: string, size: WidgetPlacement["size"]) => void;
  onSettings: (id: string) => void;
  setSettings: (id: string, s: Record<string, string>) => void;
}) {
  const controls = useDragControls();
  const def = widgetDef(placement.id) as WidgetDef;
  const Component = WIDGET_COMPONENTS[placement.id];
  if (!def || !Component) return null;
  const span = placement.size === "S" ? "col-span-1" : "col-span-2";
  return (
    <Reorder.Item
      value={placement}
      dragListener={false}
      dragControls={controls}
      className={`${span} min-w-0 list-none`}
      data-home-widget={placement.id}
      onDragEnd={(event) => {
        // Dropped over another column: move it there (Reorder only sorts inside one column).
        const e = event as PointerEvent;
        const target = typeof e.clientX === "number" ? dropTarget(e.clientX, e.clientY) : null;
        if (target && target.column !== column) onMove(placement.id, target.column, target.index);
      }}
      whileDrag={{ scale: 1.02, zIndex: 20, boxShadow: "var(--ds-elevation-3, 0 12px 32px rgba(0,0,0,.18))" }}
    >
      <Component
        def={def}
        placement={placement}
        editing={editing}
        setSettings={(s) => setSettings(placement.id, s)}
        controls={
          editing
            ? {
                column,
                index,
                count,
                onMove: (c, i) => onMove(placement.id, c, i),
                onRemove: def.pinned ? undefined : () => onRemove(placement.id),
                onResize: (size) => onResize(placement.id, size),
                onSettings: HAS_SETTINGS.has(placement.id) ? () => onSettings(placement.id) : undefined,
                onHandlePointerDown: (e) => controls.start(e),
              }
            : undefined
        }
      />
    </Reorder.Item>
  );
}

// ── Add widget (side sheet) ─────────────────────────────────────────────

function AddWidgetSheet({ open, onOpenChange, options, onAdd }: { open: boolean; onOpenChange: (o: boolean) => void; options: WidgetDef[]; onAdd: (id: string) => void }) {
  const { t } = useI18n();
  const { portalContainer } = useDesignScope();
  const reduced = useReducedMotion();
  const grouped = useMemo(() => WIDGET_CATEGORIES.map((c) => ({ category: c, items: options.filter((o) => o.category === c) })).filter((g) => g.items.length), [options]);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={portalContainer ?? undefined}>
        <Dialog.Overlay asChild>
          <motion.div className="ds-overlay" variants={motionPreset(overlayVariants, reduced)} initial="initial" animate="enter" />
        </Dialog.Overlay>
        <Dialog.Content asChild>
          <motion.aside
            className="ds-panel fixed inset-y-0 end-0 z-[61] flex w-full max-w-md flex-col gap-4 overflow-y-auto p-5"
            initial={reduced ? { opacity: 0 } : { x: "100%" }}
            animate={reduced ? { opacity: 1 } : { x: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <Dialog.Title className="text-[length:var(--ds-text-lg)] font-semibold">{t("home.add.title")}</Dialog.Title>
                <Dialog.Description className="ds-muted">{t("home.add.description")}</Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button type="button" className="ds-btn ds-btn-ghost ds-btn-sm" aria-label={t("common.close")}>
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </Dialog.Close>
            </div>
            {grouped.length === 0 ? <p className="ds-muted">{t("home.add.none")}</p> : null}
            {grouped.map((g) => (
              <section key={g.category} aria-labelledby={`add-${g.category}`} className="flex flex-col gap-2">
                <h3 id={`add-${g.category}`} className="font-medium">{t(`home.categories.${g.category}`)}</h3>
                <ul className="flex flex-col gap-2">
                  {g.items.map((d) => {
                    const Preview = WIDGET_COMPONENTS[d.id];
                    return (
                      <li key={d.id} className="flex flex-col gap-2 p-3" style={{ border: "1px solid var(--ds-border)", borderRadius: "var(--ds-radius-lg)" }}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">{t(d.titleKey)}</p>
                            <p className="text-[length:var(--ds-text-xs)] ds-muted">{t(d.descriptionKey)}</p>
                          </div>
                          <button type="button" className="ds-btn ds-btn-sm ds-btn-primary shrink-0" onClick={() => onAdd(d.id)}>
                            <Plus className="h-4 w-4" aria-hidden />
                            {t("home.add.add")}
                          </button>
                        </div>
                        {/* A small, inert preview: no data is loaded for it. */}
                        <div className="pointer-events-none max-h-32 overflow-hidden opacity-80 [mask-image:linear-gradient(to_bottom,black_60%,transparent)]" aria-hidden inert>
                          {Preview ? <div className="origin-top-left scale-[0.8]" style={{ width: "125%" }}><Preview def={d} placement={{ id: d.id, size: d.defaultSize }} editing={false} preview setSettings={() => undefined} /></div> : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </motion.aside>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── Widget settings (weather city, clock face and time zone) ────────────

const TIME_ZONES = ["Asia/Baku", "Europe/Istanbul", "Europe/Moscow", "Asia/Dubai", "Europe/London", "Europe/Berlin", "America/New_York", "Asia/Tbilisi"];

function WidgetSettingsDialog({ id, placement, onClose, onSave }: { id: string | null; placement: WidgetPlacement | null; onClose: () => void; onSave: (id: string, settings: Record<string, string>) => void }) {
  return id && placement ? <SettingsForm id={id} placement={placement} onClose={onClose} onSave={onSave} /> : null;
}

function SettingsForm({ id, placement, onClose, onSave }: { id: string; placement: WidgetPlacement; onClose: () => void; onSave: (id: string, settings: Record<string, string>) => void }) {
  const { t } = useI18n();
  const { portalContainer } = useDesignScope();
  const [city, setCity] = useState(placement.settings?.city ?? "");
  const [face, setFace] = useState(placement.settings?.face ?? "digital");
  const [timeZone, setTimeZone] = useState(placement.settings?.timeZone ?? "Asia/Baku");
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const submit = () => {
    if (id === "weather") {
      if (city.trim() && !cleanCity(city)) {
        setError(t("home.settings.cityInvalid"));
        return;
      }
      onSave(id, { ...(placement.settings ?? {}), city: cleanCity(city) ?? "" });
    } else {
      onSave(id, { ...(placement.settings ?? {}), face, timeZone });
    }
  };
  return (
    <Dialog.Root open onOpenChange={(o) => (o ? undefined : onClose())}>
      <Dialog.Portal container={portalContainer ?? undefined}>
        <Dialog.Overlay className="ds-overlay" />
        <Dialog.Content className="ds-panel fixed left-1/2 top-1/2 z-[61] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 p-5" onOpenAutoFocus={(e) => { e.preventDefault(); first.current?.focus(); }}>
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <Dialog.Title className="flex items-center gap-2 font-semibold">
              <Settings2 className="h-4 w-4" aria-hidden />
              {t("home.settings.title", { name: t(`home.widgets.${id}.title`) })}
            </Dialog.Title>
            <Dialog.Description className="sr-only">{t("home.settings.title", { name: t(`home.widgets.${id}.title`) })}</Dialog.Description>
            {id === "weather" ? (
              <label className="flex flex-col gap-1.5">
                <span className="ds-label">{t("home.settings.city")}</span>
                <input ref={(el) => { first.current = el; }} className="ds-input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Baku" maxLength={60} />
                <span className="text-[length:var(--ds-text-xs)] ds-subtle">{t("home.settings.cityHint")}</span>
              </label>
            ) : (
              <>
                <label className="flex flex-col gap-1.5">
                  <span className="ds-label">{t("home.settings.face")}</span>
                  <select ref={(el) => { first.current = el; }} className="ds-input" value={face} onChange={(e) => setFace(e.target.value)}>
                    <option value="digital">{t("home.settings.digital")}</option>
                    <option value="analogue">{t("home.settings.analogue")}</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="ds-label">{t("home.settings.timeZone")}</span>
                  <select className="ds-input" value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
                    {TIME_ZONES.map((z) => <option key={z} value={z}>{z.replace("_", " ")}</option>)}
                  </select>
                </label>
              </>
            )}
            {error ? <p role="alert" className="text-[length:var(--ds-text-sm)]" style={{ color: "var(--ds-danger-strong)" }}>{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild><button type="button" className="ds-btn">{t("common.cancel")}</button></Dialog.Close>
              <button type="submit" className="ds-btn ds-btn-primary">{t("common.save")}</button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

