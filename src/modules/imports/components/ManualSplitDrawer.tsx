"use client";

import { useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { formatMoney } from "@/lib/dates/localeDate";
import { fromCents, toCents } from "@/lib/imports/landedCost";
import { parseDecimalInput } from "@/components/line-grid/logic";
import type { CostLineDraft, ShipmentDraft } from "../lib/shipment";
import { SideDrawer } from "./SideDrawer";

/**
 * The manual split of one cost (IMP-4, from the cost row's "…" menu): an AZN amount per product
 * line and what is left; the amounts must add up to the cost before the draft can be saved.
 */
export function ManualSplitDrawer({
  cost,
  draft,
  amountAzn,
  editable,
  lineName,
  onClose,
  onApply,
}: {
  cost: CostLineDraft;
  draft: ShipmentDraft;
  /** The cost in AZN. */
  amountAzn: number;
  editable: boolean;
  /** "code · name" of a product line. */
  lineName: (lineKey: string) => string;
  onClose: () => void;
  onApply: (manual: Record<string, number>) => void;
}) {
  const { t, locale } = useI18n();
  const [values, setValues] = useState<Record<string, number>>(() => ({ ...cost.manual }));
  const [texts, setTexts] = useState<Record<string, string>>(() => Object.fromEntries(draft.lines.map((l) => [l.key, String(cost.manual[l.key] ?? 0)])));
  const typed = draft.lines.reduce((s, l) => s + toCents(values[l.key] ?? 0), 0);
  const left = fromCents(toCents(amountAzn) - typed);
  const money = (n: number) => formatMoney(n, locale, { currency: "AZN" });

  return (
    <SideDrawer
      title={t("imports.manual.title", { cost: cost.description || t(`imports.costTypes.${cost.costType}`) })}
      description={t("imports.manual.hint", { amount: money(amountAzn) })}
      onClose={onClose}
      footer={
        editable ? (
          <>
            <button type="button" className="ds-btn" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button type="button" className="ds-btn ds-btn-primary" onClick={() => onApply(values)}>
              {t("imports.whSplit.apply")}
            </button>
          </>
        ) : null
      }
    >
      <div className="flex flex-col gap-2">
        {draft.lines.map((l, i) => (
          <label key={l.key} className="ds-split-row" style={{ gridTemplateColumns: "minmax(0, 1fr) 8rem" }}>
            <span className="truncate text-[length:var(--ds-text-sm)]">
              {i + 1}. {lineName(l.key) || "—"}
            </span>
            <input
              className="ds-input ds-mono text-end tabular-nums"
              inputMode="decimal"
              type="text"
              disabled={!editable}
              aria-label={`${t("imports.costFields.manualSplit")} ${i + 1}`}
              value={texts[l.key] ?? ""}
              onChange={(e) => {
                setTexts((x) => ({ ...x, [l.key]: e.target.value }));
                const parsed = parseDecimalInput(e.target.value, { min: 0 });
                if (parsed.valid) setValues((v) => ({ ...v, [l.key]: parsed.value ?? 0 }));
              }}
            />
          </label>
        ))}
      </div>
      <div className="ds-split-remaining" data-state={Math.abs(left) < 0.005 ? "ok" : left > 0 ? "short" : "over"} role="status" aria-live="polite">
        <span>{t("imports.whSplit.remaining")}</span>
        <strong>{money(left)}</strong>
      </div>
    </SideDrawer>
  );
}
