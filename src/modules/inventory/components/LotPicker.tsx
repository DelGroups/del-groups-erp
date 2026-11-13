"use client";

import { useEffect, useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { motion, useReducedMotion } from "motion/react";
import { Plus, Split, Trash2 } from "lucide-react";
import { Button, Chip, Combobox, IconButton, type ComboOption } from "@/design-system/components";
import { motionPreset, panelVariants } from "@/design-system/motion";
import { useI18n } from "@/i18n/I18nProvider";
import { comboboxLabels } from "@/i18n/uiStandardLabels";
import { formatGridDate, formatQuantity } from "@/lib/dates/localeDate";
import { bakuToday } from "@/lib/documents/dateChange";
import { listDocumentLots, listProductLots, type ProductLotsResult } from "../actions/lots";
import {
  addSplitRow,
  chooseSingle,
  choiceSummary,
  followQuantity,
  lotChoiceIssue,
  lotExpiry,
  lotsOfLine,
  sortLotsFefo,
  suggestFefo,
  type DocumentLotRow,
  type LotChoice,
  type LotOption,
} from "../lib/lotPicker";
import { LotChip } from "./LotFields";

const AUTO = "__auto";
const SPLIT = "__split";

/** isoToDots-like for a yyyy-mm-dd date. */
const showDate = (iso: string | null) => (iso ? formatGridDate(iso) : "");

// One request per product and warehouse while a form is open (the list does not change under it).
const cache = new Map<string, Promise<ProductLotsResult>>();
function loadLots(productId: string, warehouseId: string): Promise<ProductLotsResult> {
  const key = `${productId}:${warehouseId}`;
  let p = cache.get(key);
  if (!p) {
    p = listProductLots(productId, warehouseId).catch(() => ({ lots: [], canManage: false }));
    cache.set(key, p);
    // Fresh again after a minute (another document may have taken stock).
    setTimeout(() => cache.delete(key), 60_000);
  }
  return p;
}

/** The lots of a product in a warehouse (empty while loading or without lots.view). */
export function useProductLots(productId: string | null | undefined, warehouseId: string | null | undefined): ProductLotsResult & { loading: boolean } {
  const [state, setState] = useState<{ key: string; data: ProductLotsResult } | null>(null);
  const key = productId && warehouseId ? `${productId}:${warehouseId}` : "";
  useEffect(() => {
    if (!productId || !warehouseId) return;
    let alive = true;
    void loadLots(productId, warehouseId).then((data) => {
      if (alive) setState({ key: `${productId}:${warehouseId}`, data });
    });
    return () => {
      alive = false;
    };
  }, [productId, warehouseId]);
  const data = state && state.key === key ? state.data : { lots: [], canManage: false };
  return { ...data, loading: Boolean(key) && state?.key !== key };
}

type T = (key: string, params?: Record<string, string | number>) => string;

/** The badge of a lot: quarantine, expired or near expiry (none when fine). */
export function LotStatusBadge({ lot, today }: { lot: LotOption; today: string }) {
  const { t } = useI18n();
  if (lot.status !== "active") return <Chip tone="danger">{t(lot.status === "quarantine" ? "lots.picker.quarantine" : "lots.picker.closed")}</Chip>;
  const exp = lotExpiry(lot.expDate, today);
  if (exp === "expired") return <Chip tone="danger">{t("lots.picker.expired")}</Chip>;
  if (exp === "near") return <Chip tone="warning">{t("lots.picker.nearExpiry")}</Chip>;
  return null;
}

function lotOptions(lots: readonly LotOption[], { t, today, canManage, unit, locale }: { t: T; today: string; canManage: boolean; unit: string; locale: string }): ComboOption[] {
  return sortLotsFefo(lots).map((l) => {
    const exp = lotExpiry(l.expDate, today);
    const state =
      l.status === "quarantine" ? t("lots.picker.quarantine") : l.status === "closed" ? t("lots.picker.closed") : exp === "expired" ? t("lots.picker.expired") : exp === "near" ? t("lots.picker.nearExpiry") : null;
    const hint = [l.supplierBatchNo, l.expDate ? t("lots.picker.expShort", { date: showDate(l.expDate) }) : null, state].filter(Boolean).join(" · ");
    return {
      value: l.id,
      label: l.lotNo,
      hint: hint || undefined,
      meta: `${formatQuantity(l.qty, locale)} ${unit}`.trim(),
      // FEFO never picks a quarantined lot; an expired one only with lots.manage.
      disabled: l.status !== "active" || (exp === "expired" && !canManage),
    };
  });
}

export interface LotPickerProps {
  productId: string | null | undefined;
  warehouseId: string | null | undefined;
  /** The line quantity (stock unit). */
  quantity: number;
  unit?: string | null;
  /** null / empty = automatic (FEFO); nothing is sent. */
  value: readonly LotChoice[] | null | undefined;
  onChange: (value: LotChoice[] | null) => void;
  disabled?: boolean;
  invalid?: boolean;
  /** Accessible name ("Lot: <product>"). */
  label: string;
}

/**
 * LOT-3: the lots an outbound line takes. A Combobox of the product's lots in the line's
 * warehouse (quantity, supplier batch, expiry and status), FEFO first, with "Automatic (FEFO)" on
 * top showing what automatic picking would take; the split button opens a popover to spread the
 * line over several lots. Quarantined lots cannot be chosen; an expired lot only with lots.manage
 * (with a warning). Imported by other modules only through `@/modules/inventory`.
 */
export function LotPicker({ productId, warehouseId, quantity, unit, value, onChange, disabled, invalid, label }: LotPickerProps) {
  const { t, locale } = useI18n();
  const today = bakuToday();
  const { lots, canManage, loading } = useProductLots(productId, warehouseId);
  const [splitOpen, setSplitOpen] = useState(false);
  // A single chosen lot always takes the whole line (it follows the quantity).
  const choice = followQuantity(value, quantity);
  const u = unit ?? "";

  const fefo = useMemo(() => suggestFefo(lots, quantity), [lots, quantity]);
  const fefoText = choiceSummary(fefo.choice, lots, (n) => formatQuantity(n, locale));
  const options = useMemo<ComboOption[]>(
    () => [
      {
        value: AUTO,
        label: t("lots.picker.auto"),
        hint: fefoText ? t("lots.picker.fefoTakes", { lots: fefoText }) : lots.length ? undefined : t("lots.picker.noLots"),
      },
      ...lotOptions(lots, { t, today, canManage, unit: u, locale }),
    ],
    [lots, fefoText, t, today, canManage, u, locale],
  );

  const issue = lotChoiceIssue(choice, quantity, lots, { today, canManage });
  const chosenLots = (choice ?? []).map((c) => lots.find((l) => l.id === c.lotId)).filter((l): l is LotOption => !!l);
  const summary = choiceSummary(choice, lots, (n) => formatQuantity(n, locale));
  const comboValue = !choice ? AUTO : choice.length === 1 ? choice[0].lotId : SPLIT;

  if (!productId || !warehouseId) {
    return <span className="ds-muted text-[length:var(--ds-text-sm)]">{t("lots.picker.auto")}</span>;
  }

  return (
    <span className="flex min-w-0 items-center gap-1" data-lot-picker="">
      <span className="ds-line-lookup min-w-0 flex-1">
        <Combobox
          value={comboValue}
          selectedLabel={choice ? summary ?? undefined : undefined}
          onChange={(next) => onChange(!next || next === AUTO ? null : chooseSingle(next, quantity))}
          options={options}
          labels={{ ...comboboxLabels(t), loading: t("uiStandard.combobox.loading") }}
          locale={locale}
          clearable={false}
          disabled={disabled || loading}
          invalid={invalid || Boolean(issue)}
          width="full"
          aria-label={label}
        />
      </span>
      {chosenLots.map((l) => (
        <LotStatusBadge key={l.id} lot={l} today={today} />
      ))}
      <Popover.Root open={splitOpen} onOpenChange={setSplitOpen}>
        <Popover.Trigger asChild>
          <IconButton size="sm" label={t("lots.picker.split", { name: label })} icon={<Split className="h-3.5 w-3.5" aria-hidden />} disabled={disabled || loading || lots.length === 0} />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="end" sideOffset={6} collisionPadding={12} className="z-50">
            <LotSplitPanel
              lots={lots}
              quantity={quantity}
              unit={u}
              value={choice}
              canManage={canManage}
              today={today}
              label={label}
              onChange={onChange}
              onClose={() => setSplitOpen(false)}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </span>
  );
}

function LotSplitPanel({
  lots,
  quantity,
  unit,
  value,
  canManage,
  today,
  label,
  onChange,
  onClose,
}: {
  lots: LotOption[];
  quantity: number;
  unit: string;
  value: readonly LotChoice[] | null;
  canManage: boolean;
  today: string;
  label: string;
  onChange: (value: LotChoice[] | null) => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const reduced = useReducedMotion();
  const [rows, setRows] = useState<LotChoice[]>(() => (value?.length ? [...value] : suggestFefo(lots, quantity).choice));
  const options = useMemo(() => lotOptions(lots, { t, today, canManage, unit, locale }), [lots, t, today, canManage, unit, locale]);
  const issue = lotChoiceIssue(rows, quantity, lots, { today, canManage });
  const sum = rows.reduce((s, r) => s + (r.qty || 0), 0);
  const set = (i: number, patch: Partial<LotChoice>) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const expiredChosen = rows.some((r) => lotExpiry(lots.find((l) => l.id === r.lotId)?.expDate, today) === "expired");

  return (
    <motion.div
      className="ds-menu flex w-[min(92vw,30rem)] flex-col gap-3 p-3"
      initial="initial"
      animate="enter"
      variants={motionPreset(panelVariants, reduced)}
      role="group"
      aria-label={t("lots.picker.splitTitle", { name: label })}
    >
      <p className="font-medium text-[length:var(--ds-text-sm)]">{t("lots.picker.splitTitle", { name: label })}</p>
      <ul className="flex flex-col gap-2">
        {rows.map((r, i) => {
          const lot = lots.find((l) => l.id === r.lotId);
          return (
            <li key={`${r.lotId}-${i}`} className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <Combobox
                  value={r.lotId}
                  onChange={(next) => next && set(i, { lotId: next })}
                  options={options}
                  labels={comboboxLabels(t)}
                  locale={locale}
                  clearable={false}
                  width="full"
                  aria-label={t("lots.picker.rowLot", { n: i + 1 })}
                />
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                className="ds-input ds-mono w-24 tabular-nums"
                value={Number.isFinite(r.qty) ? r.qty : ""}
                aria-label={t("lots.picker.rowQty", { n: i + 1, lot: lot?.lotNo ?? "" })}
                onChange={(e) => set(i, { qty: Number(e.target.value) })}
              />
              {lot ? <LotStatusBadge lot={lot} today={today} /> : null}
              <IconButton
                size="sm"
                label={t("lots.picker.removeRow", { n: i + 1 })}
                icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}
                onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
              />
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" icon={Plus} onClick={() => setRows((prev) => addSplitRow(prev, quantity, lots))} disabled={rows.length >= lots.length}>
          {t("lots.picker.addRow")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setRows(suggestFefo(lots, quantity).choice)}>
          {t("lots.picker.fillFefo")}
        </Button>
        <span className="ms-auto tabular-nums text-[length:var(--ds-text-xs)] ds-muted">
          {t("lots.picker.sum", { sum: formatQuantity(sum, locale), total: formatQuantity(quantity, locale), unit })}
        </span>
      </div>
      {issue ? (
        <p role="alert" className="text-[length:var(--ds-text-xs)]" style={{ color: "var(--ds-danger, #e11d48)" }}>
          {t(`lots.pickerIssues.${issue}`)}
        </p>
      ) : expiredChosen ? (
        <p role="status" className="text-[length:var(--ds-text-xs)]" style={{ color: "var(--ds-warning, #b45309)" }}>
          {t("lots.picker.expiredWarning")}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            onChange(null);
            onClose();
          }}
        >
          {t("lots.picker.useAuto")}
        </Button>
        <Button
          size="sm"
          disabled={Boolean(issue) || rows.length === 0}
          onClick={() => {
            onChange(rows.map((r) => ({ lotId: r.lotId, qty: Math.round(r.qty * 1000) / 1000 })));
            onClose();
          }}
        >
          {t("lots.picker.apply")}
        </Button>
      </div>
    </motion.div>
  );
}

/** A non-editable picker for a line whose stock does not leave by lots here (a Polywood sale mode). */
export function LotAutoText() {
  const { t } = useI18n();
  return <span className="ds-muted text-[length:var(--ds-text-sm)]">{t("lots.picker.auto")}</span>;
}

/** The lots a posted document took, read once per document (LOT_TRACKING on; empty otherwise). */
export function useDocumentLots(
  docType: string,
  docId: string | null | undefined,
  enabled: boolean,
  direction: "out" | "in" = "out",
  /** Read again when this changes (e.g. the number of issued lines). */
  refreshKey: string | number = 0,
): DocumentLotRow[] {
  const [rows, setRows] = useState<{ id: string; rows: DocumentLotRow[] } | null>(null);
  useEffect(() => {
    if (!enabled || !docId) return;
    let alive = true;
    void listDocumentLots(docType, docId, direction)
      .then((r) => alive && setRows({ id: docId, rows: r }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [docType, docId, enabled, direction, refreshKey]);
  return rows && rows.id === docId ? rows.rows : [];
}

/** Read-only lot chips of one line of a posted document ("Lot LOT-2026-00012 ×3"). */
export function DocumentLotChips({ rows, lineId, productId, linkable }: { rows: readonly DocumentLotRow[]; lineId?: string | null; productId?: string | null; linkable: boolean }) {
  const { locale } = useI18n();
  const lots = lotsOfLine(rows, { lineId, productId });
  if (!lots.length) return null;
  return (
    <span className="flex flex-wrap gap-1" data-document-lots="">
      {lots.map((l) => (
        <span key={l.lotId} className="inline-flex items-center gap-1">
          <LotChip lotId={l.lotId} lotNo={l.lotNo} linkable={linkable} />
          {lots.length > 1 ? <span className="ds-muted tabular-nums text-[length:var(--ds-text-xs)]">×{formatQuantity(l.qty, locale)}</span> : null}
        </span>
      ))}
    </span>
  );
}
