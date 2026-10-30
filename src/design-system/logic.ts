/**
 * Logic of the design-system components (prompt 15), kept pure and framework-free so
 * `node --test` covers it: palette filtering and keyboard movement, the toast queue, file
 * checks for the dropzone, type-to-confirm, and the maths behind the stats components.
 */

// ── Command palette ─────────────────────────────────────────────────────────

export interface PaletteCommand {
  id: string;
  label: string;
  /** Extra words that should find this command (other languages, synonyms). */
  keywords?: readonly string[];
  shortcut?: readonly string[];
  disabled?: boolean;
}

export interface PaletteGroup<C extends PaletteCommand = PaletteCommand> {
  id: string;
  heading: string;
  commands: readonly C[];
}

/** Case- and accent-insensitive key for matching (Azerbaijani İ/ı and Cyrillic included). */
export function searchKey(text: string): string {
  return text
    .replace(/İ/g, "i")
    .replace(/ı/g, "i")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ə/g, "e");
}

/** Groups with only the commands matching every word of `query`; empty groups are dropped. */
export function filterPalette<C extends PaletteCommand>(groups: readonly PaletteGroup<C>[], query: string): PaletteGroup<C>[] {
  const words = searchKey(query).split(/\s+/).filter(Boolean);
  if (!words.length) return groups.filter((g) => g.commands.length).map((g) => ({ ...g, commands: [...g.commands] }));
  return groups
    .map((g) => ({
      ...g,
      commands: g.commands.filter((c) => {
        const haystack = searchKey([c.label, ...(c.keywords ?? [])].join(" "));
        return words.every((w) => haystack.includes(w));
      }),
    }))
    .filter((g) => g.commands.length);
}

/** Index after moving by `delta` in a list of `length`, wrapping at both ends; -1 when empty. */
export function wrapIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return -1;
  return (((current + delta) % length) + length) % length;
}

// ── Toasts ──────────────────────────────────────────────────────────────────

export type ToastVariant = "success" | "error" | "info";

export interface ToastItem {
  id: string;
  title: string;
  message?: string;
  variant: ToastVariant;
  /** Total time on screen, ms. */
  duration: number;
}

export type ToastAction = { type: "add"; toast: ToastItem } | { type: "dismiss"; id: string } | { type: "clear" };

export const TOAST_LIMIT = 4;
export const TOAST_DURATION = 5000;

/** Newest at the end; beyond the limit the oldest go first. */
export function toastReducer(state: readonly ToastItem[], action: ToastAction): ToastItem[] {
  switch (action.type) {
    case "add": {
      const next = [...state.filter((t) => t.id !== action.toast.id), action.toast];
      return next.slice(Math.max(0, next.length - TOAST_LIMIT));
    }
    case "dismiss":
      return state.filter((t) => t.id !== action.id);
    case "clear":
      return [];
  }
}

// ── File dropzone ───────────────────────────────────────────────────────────

export interface FileRules {
  maxBytes: number;
  /** Extensions (".pdf") or MIME types / wildcards ("image/*"); empty = anything. */
  accept: readonly string[];
}

export type FileCheck = { ok: true } | { ok: false; reason: "tooLarge" | "wrongType" | "empty" };

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
}

export function checkFile(file: { name: string; size: number; type: string }, rules: FileRules): FileCheck {
  if (file.size <= 0) return { ok: false, reason: "empty" };
  if (file.size > rules.maxBytes) return { ok: false, reason: "tooLarge" };
  if (rules.accept.length) {
    const ext = `.${fileExtension(file.name)}`;
    const type = (file.type || "").toLowerCase();
    const allowed = rules.accept.some((a) => {
      const rule = a.trim().toLowerCase();
      if (rule.startsWith(".")) return rule === ext;
      if (rule.endsWith("/*")) return type.startsWith(rule.slice(0, -1));
      return rule === type;
    });
    if (!allowed) return { ok: false, reason: "wrongType" };
  }
  return { ok: true };
}

/** 1536 → "1.5 KB"; binary units, one decimal under 10. */
export function formatFileSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 || value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

// ── Type to confirm ─────────────────────────────────────────────────────────

/** "match" enables the action; "diverged" means the typing no longer leads to the name. */
export function confirmState(input: string, target: string): "empty" | "partial" | "diverged" | "match" {
  if (!input) return "empty";
  if (input === target) return "match";
  return target.startsWith(input) ? "partial" : "diverged";
}

// ── Stats ───────────────────────────────────────────────────────────────────

/** Bar heights in percent of the largest value; a minimum keeps zero bars visible. */
export function sparklineHeights(values: readonly number[], minPercent = 8): number[] {
  const max = Math.max(0, ...values.map((v) => (Number.isFinite(v) ? v : 0)));
  return values.map((v) => (max <= 0 || !Number.isFinite(v) || v <= 0 ? minPercent : Math.max(minPercent, Math.round((v / max) * 100))));
}

export function deltaKind(delta: number): "up" | "down" | "flat" {
  if (!Number.isFinite(delta) || Math.abs(delta) < 1e-9) return "flat";
  return delta > 0 ? "up" : "down";
}

/** Stroke dash values for a ring of radius `r` filled to `percent` (clamped 0…100). */
export function ringDash(percent: number, r: number): { circumference: number; offset: number; percent: number } {
  const p = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));
  const circumference = 2 * Math.PI * r;
  return { circumference, offset: circumference * (1 - p / 100), percent: p };
}

export interface FunnelStep {
  label: string;
  count: number;
}

export interface FunnelRow extends FunnelStep {
  /** Width of the bar: share of the first step, 0…100. */
  percentOfFirst: number;
  /** Share kept from the previous step (100 for the first). */
  stepConversion: number;
  /** Lost since the previous step (0 for the first). */
  dropped: number;
  droppedPercent: number;
  /** Print the percentage inside the bar when it is wide enough. */
  labelInside: boolean;
}

export function funnelRows(steps: readonly FunnelStep[], insideFrom = 18): FunnelRow[] {
  const first = Math.max(0, steps[0]?.count ?? 0);
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
  return steps.map((s, i) => {
    const count = Math.max(0, s.count);
    const prev = i === 0 ? count : Math.max(0, steps[i - 1].count);
    const dropped = i === 0 ? 0 : Math.max(0, prev - count);
    const percentOfFirst = pct(count, first);
    return {
      label: s.label,
      count,
      percentOfFirst,
      stepConversion: i === 0 ? 100 : pct(count, prev),
      dropped,
      droppedPercent: i === 0 ? 0 : pct(dropped, prev),
      labelInside: percentOfFirst >= insideFrom,
    };
  });
}

export function funnelSummary(steps: readonly FunnelStep[]): { entered: number; completed: number; conversion: number } {
  const entered = Math.max(0, steps[0]?.count ?? 0);
  const completed = Math.max(0, steps.at(-1)?.count ?? 0);
  return { entered, completed, conversion: entered > 0 ? Math.round((completed / entered) * 1000) / 10 : 0 };
}

/**
 * Goal progress: percent of target (bar capped at 100) and whether it is on track, given how
 * much of the period has passed (0…1). Behind = less than 90 % of the expected progress.
 */
export function goalProgress(current: number, target: number, periodElapsed = 1): { percent: number; bar: number; status: "done" | "onTrack" | "behind" } {
  const percent = target > 0 ? Math.round((current / target) * 1000) / 10 : 0;
  const bar = Math.min(100, Math.max(0, percent));
  if (percent >= 100) return { percent, bar, status: "done" };
  const expected = Math.min(1, Math.max(0, periodElapsed)) * 100;
  return { percent, bar, status: percent >= expected * 0.9 ? "onTrack" : "behind" };
}

/** Heatmap cell shading: alpha follows the percentage; white text once the cell is dark. */
export function heatCell(percent: number | null): { alpha: number; darkText: boolean; empty: boolean } {
  if (percent === null || !Number.isFinite(percent)) return { alpha: 0, darkText: true, empty: true };
  const p = Math.min(100, Math.max(0, percent));
  const alpha = Math.round((0.08 + (p / 100) * 0.86) * 100) / 100;
  return { alpha, darkText: alpha < 0.55, empty: false };
}

export interface StackedColumn {
  label: string;
  values: readonly number[];
}

/** Each segment's height as a percent of the tallest column total, so the chart fills its height. */
export function scaleStacked(columns: readonly StackedColumn[]): { label: string; total: number; heights: number[] }[] {
  const totals = columns.map((c) => c.values.reduce((s, v) => s + Math.max(0, v), 0));
  const max = Math.max(0, ...totals);
  return columns.map((c, i) => ({
    label: c.label,
    total: totals[i],
    heights: c.values.map((v) => (max > 0 ? Math.round((Math.max(0, v) / max) * 1000) / 10 : 0)),
  }));
}

/** Percentage change from `previous` to `current`, one decimal; null when there is no base. */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

// ── Count-up ────────────────────────────────────────────────────────────────

export function easeOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) ** 3;
}

/** The figure shown at `progress` (0…1) of a count-up to `target`, keeping its decimals. */
export function countUpValue(target: number, progress: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(target * easeOutCubic(progress) * factor) / factor;
}

/** Number of decimals written in a figure ("99.98" → 2). */
export function decimalsOf(value: number): number {
  const text = String(value);
  const dot = text.indexOf(".");
  return dot < 0 || /e/i.test(text) ? 0 : text.length - dot - 1;
}

/** Thousands separators per language, fixed decimals (one formatting module: src/lib/dates/localeDate.ts). */
export { formatFigure } from "../lib/dates/localeDate";

/**
 * Truncate (UI-1): the text is cut by its ellipsis, so the full text needs a tooltip. One pixel
 * of tolerance for sub-pixel rounding of the browser's layout.
 */
export function isTextTruncated(box: { scrollWidth: number; clientWidth: number; scrollHeight?: number; clientHeight?: number }): boolean {
  if (box.scrollWidth - box.clientWidth > 1) return true;
  return box.scrollHeight !== undefined && box.clientHeight !== undefined && box.scrollHeight - box.clientHeight > 1;
}

/** Combobox (UI-1): options whose label or hint contains every word of the query, case-insensitive. */
export function filterOptions<T extends { label: string; hint?: string }>(options: readonly T[], query: string, locale = "az"): T[] {
  const words = query.trim().toLocaleLowerCase(locale).split(/\s+/).filter(Boolean);
  if (!words.length) return [...options];
  return options.filter((o) => {
    const text = `${o.label} ${o.hint ?? ""}`.toLocaleLowerCase(locale);
    return words.every((w) => text.includes(w));
  });
}
