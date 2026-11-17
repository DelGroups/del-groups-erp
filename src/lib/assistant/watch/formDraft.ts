/**
 * Builds the watch's DocumentDraft from a sales or purchase form's own state, and turns a watch fix
 * (DraftPatch) back into a change of the form's lines or date (AST-5). Pure, so it is tested without React.
 * The form keeps its own state; this only reads it and returns the next value for its setters.
 */
import type { DocumentDraft, DraftLine, DraftPatch, WatchDocType } from "./rules";

/** The fields of a form line the watch reads (SaleItem and the purchase line both have them). */
export interface FormLine {
  product_id?: string | null;
  product_name?: string | null;
  quantity?: number | string | null;
  unit?: string | null;
  unit_price?: number | string | null;
  discount_percent?: number | string | null;
  /** "fixed" discounts are an amount, not a percent: the watch leaves them out of the percent checks. */
  discount_type?: string | null;
  vat_rate?: number | string | null;
}

export interface FormPayment {
  amount?: number | string | null;
  account_id?: string | null;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** A line is empty (the form's spare rows) when it has no product and no amounts. */
export function isBlankLine(l: FormLine): boolean {
  return !l.product_id && !num(l.quantity) && !num(l.unit_price);
}

export function draftFromForm(input: {
  docType: WatchDocType;
  date: string | null;
  partnerId: string | null;
  lines: FormLine[];
  total: number;
  paid: number;
  payments: FormPayment[];
  availableStock?: (line: FormLine, index: number) => number | null;
  creditLimit?: number;
  openReceivables?: number;
}): DocumentDraft {
  const lines: DraftLine[] = [];
  input.lines.forEach((l, index) => {
    if (isBlankLine(l)) return;
    lines.push({
      index,
      productId: l.product_id || null,
      productName: (l.product_name || "").trim(),
      quantity: num(l.quantity),
      unit: (l.unit || "").trim(),
      unitPrice: num(l.unit_price),
      discountPercent: l.discount_type === "fixed" ? 0 : num(l.discount_percent),
      vatRate: l.vat_rate == null || l.vat_rate === "" ? null : num(l.vat_rate),
      availableStock: input.availableStock && l.product_id ? input.availableStock(l, index) : null,
    });
  });
  return {
    docType: input.docType,
    date: input.date || null,
    partnerId: input.partnerId || null,
    lines,
    total: num(input.total),
    paid: num(input.paid),
    payments: input.payments
      .filter((p) => num(p.amount) !== 0)
      .map((p) => ({ amount: num(p.amount), accountId: p.account_id || null })),
    creditLimit: input.creditLimit,
    openReceivables: input.openReceivables,
  };
}

const LINE_FIELD: Record<Exclude<DraftPatch, { target: "header" }>["field"], keyof FormLine> = {
  unitPrice: "unit_price",
  discountPercent: "discount_percent",
  quantity: "quantity",
  unit: "unit",
  vatRate: "vat_rate",
};

/** A line fix as the form's own partial line (for a form that applies edits through its own line rules). */
export function formLinePatch(patch: Extract<DraftPatch, { target: "line" }>): Partial<FormLine> {
  return { [LINE_FIELD[patch.field]]: patch.field === "unit" ? String(patch.value) : Number(patch.value) } as Partial<FormLine>;
}

/** The form's next lines after a line fix (the same array when the patch is for the header or out of range). */
export function patchFormLines<T extends FormLine>(lines: T[], patch: DraftPatch): T[] {
  if (patch.target !== "line") return lines;
  if (patch.index < 0 || patch.index >= lines.length) return lines;
  const key = LINE_FIELD[patch.field];
  const value = patch.field === "unit" ? String(patch.value) : Number(patch.value);
  return lines.map((l, i) => (i === patch.index ? ({ ...l, [key]: value } as T) : l));
}
