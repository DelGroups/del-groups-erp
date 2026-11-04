"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { EntityLookup, type LookupRecord } from "@/components/lookups";
import { IconButton } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { formatQuantity } from "@/lib/dates/localeDate";
import { parseDecimalInput } from "@/components/line-grid/logic";
import type { ImportLookups } from "../actions/imports";
import { checkSplit, newSplitKey, splitStockQuantities, startSplit, type LineWarehouseSplit } from "../lib/lineWarehouses";
import type { ImportProduct, ShipmentLineDraft } from "../lib/shipment";
import { SideDrawer } from "./SideDrawer";

/**
 * "Split across warehouses" (IMP-4): rows warehouse | quantity in the purchase unit (with the
 * stock-unit equivalent) and a remaining counter; the rows must add up to the line (whole sheets
 * for sheet products) before they are kept. One row left = one warehouse again.
 */
export function WarehouseSplitDrawer({
  line,
  product,
  defaultWarehouseId,
  warehouses,
  editable,
  onRemember,
  onClose,
  onApply,
}: {
  line: ShipmentLineDraft;
  product: ImportProduct | undefined;
  defaultWarehouseId: string | null;
  warehouses: ImportLookups["warehouses"];
  editable: boolean;
  onRemember: (row: LookupRecord) => void;
  onClose: () => void;
  onApply: (splits: LineWarehouseSplit[]) => void;
}) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<LineWarehouseSplit[]>(() => startSplit(line, defaultWarehouseId));
  const sheet = product?.sheetLengthM ?? null;
  const check = checkSplit(line, rows, sheet);
  const stock = splitStockQuantities(line, rows, sheet);
  const unit = line.purchaseUnit ?? "";
  const stockUnit = sheet ? t("imports.units.metre") : unit;
  const name = product ? `${product.code} · ${product.name}` : "";
  const set = (key: string, patch: Partial<LineWarehouseSplit>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const state = Math.abs(check.remaining) <= 0.0005 ? "ok" : check.remaining > 0 ? "short" : "over";

  return (
    <SideDrawer
      title={t("imports.whSplit.title", { name })}
      description={t(sheet ? "imports.whSplit.hintSheets" : "imports.whSplit.hint", { qty: formatQuantity(line.qtyPurchase, locale), unit })}
      onClose={onClose}
      footer={
        editable ? (
          <>
            <button type="button" className="ds-btn" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button type="button" className="ds-btn ds-btn-primary" disabled={check.issues.length > 0} onClick={() => onApply(rows)}>
              {t("imports.whSplit.apply")}
            </button>
          </>
        ) : null
      }
    >
      <div className="flex flex-col gap-2" role="group" aria-label={t("imports.whSplit.title", { name })}>
        {rows.map((r, i) => {
          const bad = check.badRows.includes(r.key);
          return (
            <div key={r.key} className="ds-split-row" data-invalid={bad ? "" : undefined}>
              <EntityLookup
                entity="warehouse"
                size="sm"
                width="full"
                inlineAdd={false}
                value={r.warehouseId}
                selectedLabel={warehouses.find((w) => w.id === r.warehouseId)?.name}
                onChange={(id, row) => {
                  if (row) onRemember(row);
                  set(r.key, { warehouseId: id });
                }}
                disabled={!editable}
                invalid={bad && !r.warehouseId}
                aria-label={`${t("imports.whSplit.warehouse")} ${i + 1}`}
              />
              <QtyInput
                value={r.qtyPurchase}
                disabled={!editable}
                invalid={bad}
                label={`${t("imports.whSplit.qty")} ${i + 1}`}
                onChange={(v) => set(r.key, { qtyPurchase: v })}
              />
              <span className="text-[length:var(--ds-text-xs)] ds-muted tabular-nums whitespace-nowrap">
                {unit}
                {sheet ? ` · ${formatQuantity(stock[i] ?? 0, locale)} ${stockUnit}` : ""}
              </span>
              {editable && rows.length > 1 ? (
                <IconButton size="sm" label={t("imports.whSplit.removeRow", { n: i + 1 })} icon={<Trash2 className="h-4 w-4" />} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} />
              ) : (
                <span />
              )}
            </div>
          );
        })}
        {editable ? (
          <button
            type="button"
            className="ds-btn ds-btn-sm ds-btn-ghost self-start"
            onClick={() => setRows((rs) => [...rs, { key: newSplitKey(), warehouseId: null, qtyPurchase: Math.max(0, check.remaining) }])}
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t("imports.whSplit.addRow")}
          </button>
        ) : null}
      </div>

      <div className="ds-split-remaining" data-state={state} role="status" aria-live="polite">
        <span>{t("imports.whSplit.remaining")}</span>
        <strong>
          {formatQuantity(check.remaining, locale)} {unit}
        </strong>
      </div>
      {check.issues.length ? (
        <ul className="flex flex-col gap-1 text-[length:var(--ds-text-xs)]" role="alert">
          {check.issues.map((code) => (
            <li key={code} style={{ color: "var(--ds-danger-strong)" }}>
              {t(`imports.whSplitIssues.${code}`)}
            </li>
          ))}
        </ul>
      ) : null}
    </SideDrawer>
  );
}

/** A quantity typed with a comma or a point; keeps what is typed. */
function QtyInput({ value, onChange, label, disabled, invalid }: { value: number; onChange: (v: number) => void; label: string; disabled?: boolean; invalid?: boolean }) {
  const [text, setText] = useState(String(value));
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    if (parseDecimalInput(text).value !== value) setText(String(value));
  }
  return (
    <input
      className="ds-input ds-mono text-end tabular-nums"
      inputMode="decimal"
      type="text"
      aria-label={label}
      aria-invalid={invalid || undefined}
      value={text}
      disabled={disabled}
      onChange={(e) => {
        setText(e.target.value);
        const parsed = parseDecimalInput(e.target.value, { min: 0 });
        if (parsed.valid) {
          setLast(parsed.value ?? 0);
          onChange(parsed.value ?? 0);
        }
      }}
    />
  );
}
