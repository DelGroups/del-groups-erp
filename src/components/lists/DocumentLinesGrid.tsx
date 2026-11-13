"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { formatFigure, formatQuantity } from "@/lib/dates/localeDate";
import { StandardGrid } from "./StandardGrid";
import { codeName } from "./standardGridLogic";

/** One read-only line of a sale or purchase document. */
export interface DocumentLine {
  key: string;
  code?: string | null;
  name: string;
  quantity: number;
  unit?: string | null;
  price: number;
  total: number;
  /** LOT-3: the line's lot chips (shown when `lotsHeader` is given). */
  lots?: React.ReactNode;
}

/**
 * The read-only lines of a sale or purchase (UI-6, behind UI_STANDARD): "code · product", quantity
 * with its unit, price and line total right-aligned with tabular figures, a sticky totals row.
 * Texts come from the caller (the headers of the old table).
 */
export function DocumentLinesGrid({
  id,
  label,
  lines,
  headers,
  total,
  decimals = 2,
  empty,
  lotsHeader,
}: {
  id: string;
  label: string;
  lines: readonly DocumentLine[];
  headers: { product: string; quantity: string; price: string; total: string };
  /** The document total under the line totals (null: no totals row). */
  total?: React.ReactNode | null;
  decimals?: number;
  /** Empty-state text; default "No records". */
  empty?: string;
  /** LOT-3: header of a lots column (LOT_TRACKING); left out = no column. */
  lotsHeader?: string;
}) {
  const { locale } = useI18n();
  return (
    <StandardGrid<DocumentLine>
      id={id}
      label={label}
      rows={lines}
      rowKey={(l) => l.key}
      empty={empty}
      columns={[
        { key: "product", header: headers.product, width: 260, cell: (l) => codeName(l.code, l.name), sortValue: (l) => l.name },
        { key: "quantity", header: headers.quantity, type: "number", cell: (l) => `${formatQuantity(l.quantity, locale)}${l.unit ? ` ${l.unit}` : ""}`, sortValue: (l) => l.quantity },
        ...(lotsHeader ? [{ key: "lots", header: lotsHeader, width: 220, cell: (l: DocumentLine) => l.lots ?? "—" }] : []),
        { key: "price", header: headers.price, type: "money", cell: (l) => formatFigure(l.price, decimals, locale), sortValue: (l) => l.price },
        { key: "total", header: headers.total, type: "money", className: "font-semibold", cell: (l) => formatFigure(l.total, decimals, locale), sortValue: (l) => l.total },
      ]}
      totals={total === null || total === undefined ? null : { total }}
    />
  );
}
