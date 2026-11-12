"use client";

import React, { useState } from "react";
import { Combobox, Truncate, type ComboOption } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { comboboxLabels } from "@/i18n/uiStandardLabels";
import { EntityLookup, type LookupRecord, type LookupWhere } from "@/components/lookups";
import type { LineCellContext } from "./LineGrid";
import { numberInputText, parseDecimalInput } from "./logic";

/*
 * Cells of LineGrid (UI-3): borderless controls that look like text until hovered or focused,
 * the row's height, one line. Esc puts back the value the cell had when it got the focus.
 * Errors are a red outline and a tooltip (the grid sets them from the column), never a line.
 */

interface BaseCellProps {
  ctx: LineCellContext;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * A number cell: keeps what is typed ("1," or "0."), reports the parsed value, right aligned
 * with tabular figures, the unit as a muted suffix in the same cell ("12 vərəq").
 */
export function LineNumberCell({
  value,
  onChange,
  ctx,
  suffix,
  min = 0,
  max,
  disabled,
  placeholder,
  onCommit,
}: BaseCellProps & {
  value: number | null;
  onChange: (value: number | null) => void;
  suffix?: string | null;
  min?: number;
  max?: number;
  /** The cell lost the focus (a rule that runs on the final value, e.g. a metre line's price). */
  onCommit?: () => void;
}) {
  const [text, setText] = useState(numberInputText(value));
  const [last, setLast] = useState(value);
  const [atFocus, setAtFocus] = useState<number | null>(value);
  const [bad, setBad] = useState(false);
  if (value !== last) {
    setLast(value);
    if (parseDecimalInput(text).value !== value) setText(numberInputText(value));
  }
  const readOnly = !ctx.editable || disabled;
  const invalid = ctx.invalid || bad;
  return (
    <span className="ds-line-num" data-invalid={invalid ? "" : undefined}>
      <input
        className="ds-line-input"
        inputMode="decimal"
        type="text"
        aria-label={ctx.label}
        aria-invalid={invalid || undefined}
        value={text}
        placeholder={placeholder}
        readOnly={readOnly}
        tabIndex={readOnly ? -1 : undefined}
        onFocus={() => setAtFocus(value)}
        onBlur={() => {
          setBad(false);
          setText(numberInputText(value));
          if (!readOnly) onCommit?.();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !readOnly) {
            e.preventDefault();
            e.stopPropagation();
            setText(numberInputText(atFocus));
            setBad(false);
            setLast(atFocus);
            onChange(atFocus);
          }
        }}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          const parsed = parseDecimalInput(next, { min, max });
          setBad(!parsed.valid);
          if (parsed.valid) {
            setLast(parsed.value);
            onChange(parsed.value);
          }
        }}
      />
      {suffix ? <span className="ds-line-suffix">{suffix}</span> : null}
    </span>
  );
}

/** A text cell (HS code, note): one line, Esc reverts. */
export function LineTextCell({
  value,
  onChange,
  ctx,
  maxLength,
  disabled,
  placeholder,
  mono,
}: BaseCellProps & { value: string | null; onChange: (value: string | null) => void; maxLength?: number; mono?: boolean }) {
  const [atFocus, setAtFocus] = useState(value);
  const readOnly = !ctx.editable || disabled;
  return (
    <input
      className={["ds-line-input", mono ? "ds-mono" : ""].join(" ")}
      type="text"
      aria-label={ctx.label}
      aria-invalid={ctx.invalid || undefined}
      value={value ?? ""}
      maxLength={maxLength}
      placeholder={placeholder}
      readOnly={readOnly}
      tabIndex={readOnly ? -1 : undefined}
      onFocus={() => setAtFocus(value)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !readOnly) {
          e.preventDefault();
          e.stopPropagation();
          onChange(atFocus);
        }
      }}
      onChange={(e) => onChange(e.target.value || null)}
    />
  );
}

/** A read-only (computed) cell: one line, ellipsis, the full text as a tooltip when cut. */
export function LineText({ children, muted, suffix, className }: { children: React.ReactNode; muted?: boolean; suffix?: string | null; className?: string }) {
  return (
    <span className={["ds-line-text", muted ? "ds-muted" : "", className ?? ""].join(" ")} data-ui-truncate="" data-ui-check="single-line">
      {children}
      {suffix ? <span className="ds-line-suffix">{suffix}</span> : null}
    </span>
  );
}

/**
 * The product cell: an EntityLookup in the row's height. Searches by name, code and barcode,
 * shows code and stock on the second line of each option, "+ New product" creates one in a
 * dialog and puts it in the row; a barcode scanned into the search picks the product.
 */
export function LineProductCell({
  value,
  selectedLabel,
  onChange,
  ctx,
  where,
  autoOpen,
  onBarcodeMiss,
  onBarcodeHit,
  placeholder,
  disabled,
  entity = "product",
}: BaseCellProps & {
  value: string | null;
  selectedLabel?: string;
  onChange: (id: string | null, record: LookupRecord | null) => void;
  where?: LookupWhere;
  autoOpen?: boolean;
  onBarcodeMiss?: (code: string) => void;
  /** A scanned barcode found one product: the form decides (e.g. add 1 to a line that has it). */
  onBarcodeHit?: (record: LookupRecord) => void;
  entity?: "product";
}) {
  if (!ctx.editable && !ctx.inDrawer) {
    return (
      <LineText>
        <Truncate>{selectedLabel || "—"}</Truncate>
      </LineText>
    );
  }
  return (
    <EntityLookup
      entity={entity}
      value={value}
      selectedLabel={selectedLabel}
      onChange={onChange}
      where={where}
      size="sm"
      width="full"
      inlineAdd={false}
      clearable={false}
      autoOpen={autoOpen}
      scanBarcodes
      onBarcodeMiss={onBarcodeMiss}
      onBarcodeHit={onBarcodeHit}
      placeholder={placeholder}
      disabled={disabled || !ctx.editable}
      invalid={ctx.invalid}
      className="ds-line-lookup"
      aria-label={ctx.label}
    />
  );
}

/** A choice from a short fixed list (currency, unit) in the row's height. */
export function LineSelectCell({
  value,
  onChange,
  options,
  ctx,
  disabled,
}: BaseCellProps & { value: string | null; onChange: (value: string) => void; options: readonly ComboOption[] }) {
  const { t, locale } = useI18n();
  if (!ctx.editable || disabled) {
    return <LineText>{options.find((o) => o.value === value)?.label ?? value ?? "—"}</LineText>;
  }
  return (
    <span className="ds-line-lookup">
      <Combobox
        value={value}
        onChange={(next) => next && onChange(next)}
        options={options}
        labels={comboboxLabels(t)}
        locale={locale}
        clearable={false}
        invalid={ctx.invalid}
        width="full"
        aria-label={ctx.label}
      />
    </span>
  );
}
