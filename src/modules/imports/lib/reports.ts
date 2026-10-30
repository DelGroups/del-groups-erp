/**
 * Imports reports (IMP-3), pure: stored rows → report rows. The server action reads the tables
 * (service role, after the imports.view + financial-figures check) and these functions shape
 * them, so tests check the figures exactly.
 *
 *   shipments  goods, capitalized costs, recoverable VAT, landed total and per stock unit, status
 *   products   landed cost per product and shipment over time (compare suppliers, shipments)
 *   vat        import VAT register for the VAT return, per month (declaration date)
 *   payables   open payables per partner in the original currency and AZN
 *   transit    goods in transit (1360) per shipment as of a date, for the month-end check
 */
import type { CostType } from "@/lib/imports/landedCost";

type Row = Record<string, unknown>;

const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? 0 : Number(v));
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const cents = (n: number) => Math.round(n * 100) / 100;

export interface ReportSource {
  shipments: readonly Row[];
  lines: readonly Row[];
  costs: readonly Row[];
  allocations: readonly Row[];
  payables: readonly Row[];
  products: readonly Row[];
  suppliers: readonly Row[];
  /** Journal lines of the shipments on 1360: {shipment_id, entry_date, debit, credit}. */
  transit: readonly Row[];
  /** Cost types that are part of the customs value (settings). */
  customsValueCostTypes: readonly CostType[];
}

/** Only posted shipments are in the reports (not drafts, not cancelled). */
const posted = (s: Row) => s.status !== "draft" && s.status !== "cancelled";

function context(src: ReportSource) {
  const supplier = new Map(src.suppliers.map((s) => [String(s.id), String(s.company_name || s.full_name || "")]));
  const product = new Map(src.products.map((p) => [String(p.id), p]));
  const costById = new Map(src.costs.map((c) => [String(c.id), c]));
  const allocByLine = new Map<string, Row[]>();
  for (const a of src.allocations) {
    const list = allocByLine.get(String(a.shipment_line_id)) ?? [];
    list.push(a);
    allocByLine.set(String(a.shipment_line_id), list);
  }
  const rate = (s: Row) => num(s.goods_rate_azn) || num(s.invoice_rate) || 1;
  const goods = (l: Row, s: Row) => cents(num(l.qty_purchase_unit) * num(l.unit_price_fc) * rate(s));
  const allocated = (l: Row, filter?: (cost: Row) => boolean) =>
    (allocByLine.get(String(l.id)) ?? []).reduce((sum, a) => {
      const cost = costById.get(String(a.cost_line_id));
      return cost && (!filter || filter(cost)) ? sum + num(a.amount_azn) : sum;
    }, 0);
  const costAzn = (c: Row) => cents(num(c.amount) * (c.currency_code === "AZN" ? 1 : num(c.rate_to_azn) || 1));
  return { supplier, product, goods, allocated, costAzn };
}

export interface ShipmentReportRow extends Row {
  id: string;
  number: string;
  status: string;
  supplier_name: string | null;
  currency_code: string;
  invoice_date: string | null;
  goods_azn: number;
  capitalized_azn: number;
  vat_azn: number;
  landed_azn: number;
  qty_stock: number;
  landed_per_unit: number | null;
}

export function shipmentsReport(src: ReportSource): ShipmentReportRow[] {
  const ctx = context(src);
  return src.shipments.filter(posted).map((s) => {
    const lines = src.lines.filter((l) => l.shipment_id === s.id);
    const costs = src.costs.filter((c) => c.shipment_id === s.id);
    const goods = cents(lines.reduce((sum, l) => sum + ctx.goods(l, s), 0));
    const capitalized = cents(lines.reduce((sum, l) => sum + ctx.allocated(l), 0));
    const vat = cents(costs.reduce((sum, c) => sum + num(c.vat_amount_azn) + (c.cost_type === "customs_vat" ? ctx.costAzn(c) : 0), 0));
    const qty = lines.reduce((sum, l) => sum + num(l.qty_stock_unit), 0);
    const landed = cents(goods + capitalized);
    return {
      id: String(s.id),
      number: String(s.number ?? ""),
      status: String(s.status),
      supplier_name: s.supplier_id ? ctx.supplier.get(String(s.supplier_id)) ?? null : null,
      currency_code: String(s.currency_code ?? ""),
      invoice_date: str(s.invoice_date),
      goods_azn: goods,
      capitalized_azn: capitalized,
      vat_azn: vat,
      landed_azn: landed,
      qty_stock: Math.round(qty * 1000) / 1000,
      landed_per_unit: qty > 0 ? Math.round((landed / qty) * 10000) / 10000 : null,
    };
  });
}

export interface ProductReportRow extends Row {
  id: string;
  product_id: string;
  product_code: string;
  product_name: string;
  shipment_number: string;
  supplier_id: string | null;
  supplier_name: string | null;
  date: string | null;
  currency_code: string;
  unit_price_fc: number;
  qty_purchase: number;
  qty_stock: number;
  landed_azn: number;
  unit_cost_purchase: number | null;
  unit_cost_stock: number | null;
}

/** One row per product line of a posted shipment, dated by the confirmation (else invoice) date. */
export function productsReport(src: ReportSource): ProductReportRow[] {
  const ctx = context(src);
  const shipments = new Map(src.shipments.filter(posted).map((s) => [String(s.id), s]));
  return src.lines.flatMap((l) => {
    const s = shipments.get(String(l.shipment_id));
    if (!s) return [];
    const p = ctx.product.get(String(l.product_id));
    const landed = cents(ctx.goods(l, s) + ctx.allocated(l));
    const qp = num(l.qty_purchase_unit);
    const qs = num(l.qty_stock_unit);
    return [{
      id: String(l.id),
      product_id: String(l.product_id),
      product_code: String(p?.code ?? ""),
      product_name: String(p?.name ?? ""),
      shipment_number: String(s.number ?? ""),
      supplier_id: str(s.supplier_id),
      supplier_name: s.supplier_id ? ctx.supplier.get(String(s.supplier_id)) ?? null : null,
      date: str(s.confirm_date) ?? str(s.invoice_date),
      currency_code: String(s.currency_code ?? ""),
      unit_price_fc: num(l.unit_price_fc),
      qty_purchase: qp,
      qty_stock: qs,
      landed_azn: landed,
      unit_cost_purchase: qp > 0 ? Math.round((landed / qp) * 10000) / 10000 : null,
      unit_cost_stock: qs > 0 ? Math.round((landed / qs) * 10000) / 10000 : null,
    }];
  });
}

export interface VatReportRow extends Row {
  id: string;
  month: string | null;
  shipment_number: string;
  supplier_name: string | null;
  declaration_no: string | null;
  declaration_date: string | null;
  customs_value_azn: number;
  duty_azn: number;
  customs_vat_azn: number;
  local_vat_azn: number;
  total_vat_azn: number;
}

/** Import VAT register: one row per posted shipment, its month from the declaration date. */
export function vatReport(src: ReportSource): VatReportRow[] {
  const ctx = context(src);
  const inValue = new Set<string>(src.customsValueCostTypes);
  return src.shipments.filter(posted).map((s) => {
    const lines = src.lines.filter((l) => l.shipment_id === s.id);
    const costs = src.costs.filter((c) => c.shipment_id === s.id);
    const customsValue = cents(lines.reduce((sum, l) => sum + ctx.goods(l, s) + ctx.allocated(l, (c) => inValue.has(String(c.cost_type))), 0));
    const duty = cents(costs.filter((c) => c.cost_type === "customs_duty").reduce((sum, c) => sum + ctx.costAzn(c), 0));
    const customsVat = cents(costs.filter((c) => c.cost_type === "customs_vat").reduce((sum, c) => sum + ctx.costAzn(c) + num(c.vat_amount_azn), 0));
    const localVat = cents(costs.filter((c) => c.cost_type !== "customs_vat").reduce((sum, c) => sum + num(c.vat_amount_azn), 0));
    const date = str(s.customs_declaration_date) ?? str(s.confirm_date) ?? str(s.invoice_date);
    return {
      id: String(s.id),
      month: date ? date.slice(0, 7) : null,
      shipment_number: String(s.number ?? ""),
      supplier_name: s.supplier_id ? ctx.supplier.get(String(s.supplier_id)) ?? null : null,
      declaration_no: str(s.customs_declaration_no),
      declaration_date: str(s.customs_declaration_date),
      customs_value_azn: customsValue,
      duty_azn: duty,
      customs_vat_azn: customsVat,
      local_vat_azn: localVat,
      total_vat_azn: cents(customsVat + localVat),
    };
  });
}

export interface PayableReportRow extends Row {
  id: string;
  partner_id: string;
  partner_name: string;
  shipment_number: string;
  source: "goods" | "cost";
  cost_type: string | null;
  document_date: string;
  currency_code: string;
  open_fc: number;
  open_azn: number;
  age_days: number;
}

/** Open payables (not paid, not cancelled) with what is still owed in both currencies. */
export function payablesReport(src: ReportSource, today: Date): PayableReportRow[] {
  const ctx = context(src);
  const shipments = new Map(src.shipments.map((s) => [String(s.id), s]));
  const costs = new Map(src.costs.map((c) => [String(c.id), c]));
  return src.payables
    .filter((p) => p.status === "open")
    .map((p) => {
      const date = String(p.document_date);
      const age = Math.max(0, Math.floor((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.parse(`${date}T00:00:00Z`)) / 86400000));
      return {
        id: String(p.id),
        partner_id: String(p.partner_id),
        partner_name: ctx.supplier.get(String(p.partner_id)) ?? "",
        shipment_number: String(shipments.get(String(p.shipment_id))?.number ?? ""),
        source: p.source === "cost" ? "cost" : "goods",
        cost_type: p.cost_line_id ? String(costs.get(String(p.cost_line_id))?.cost_type ?? "") || null : null,
        document_date: date,
        currency_code: String(p.currency_code),
        open_fc: cents(num(p.amount_fc) - num(p.paid_fc)),
        open_azn: cents(num(p.amount_azn) - num(p.paid_azn)),
        age_days: age,
      };
    });
}

export interface TransitReportRow extends Row {
  id: string;
  shipment_number: string;
  status: string;
  supplier_name: string | null;
  balance_azn: number;
  last_entry_date: string | null;
}

/** 1360 per shipment as of a date (entries dated up to it); shipments with a balance only. */
export function transitReport(src: ReportSource, asOf: string): TransitReportRow[] {
  const ctx = context(src);
  const balance = new Map<string, { sum: number; last: string | null }>();
  for (const t of src.transit) {
    const date = String(t.entry_date ?? "");
    if (!date || date > asOf) continue;
    const key = String(t.shipment_id);
    const b = balance.get(key) ?? { sum: 0, last: null };
    b.sum += num(t.debit) - num(t.credit);
    if (!b.last || date > b.last) b.last = date;
    balance.set(key, b);
  }
  return src.shipments.flatMap((s) => {
    const b = balance.get(String(s.id));
    if (!b || Math.abs(b.sum) < 0.005) return [];
    return [{
      id: String(s.id),
      shipment_number: String(s.number ?? ""),
      status: String(s.status),
      supplier_name: s.supplier_id ? ctx.supplier.get(String(s.supplier_id)) ?? null : null,
      balance_azn: cents(b.sum),
      last_entry_date: b.last,
    }];
  });
}
