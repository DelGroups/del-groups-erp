/**
 * Stored rows → the form's draft and the list's rows (IMP-1). Pure, so tests cover what the
 * server actions return. Users without financial figures get every amount as 0 / null.
 */
import { isImportCurrency } from "@/lib/imports/cbar";
import { COST_TYPES, SPLIT_METHODS, type CostType, type SplitMethod } from "@/lib/imports/landedCost";
import { INCOTERMS, SHIPMENT_STATUSES, type Incoterm, type ShipmentDraft, type ShipmentStatus } from "./shipment";

type Row = Record<string, unknown>;

const num = (v: unknown, fallback = 0) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? fallback : Number(v));
const numOrNull = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const pick = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback);

/** A stored shipment as the form's draft; row keys are the stored ids. */
export function shipmentFromRows(header: Row, lines: readonly Row[], costs: readonly Row[], allocations: readonly Row[], financials: boolean): ShipmentDraft {
  const money = (v: unknown) => (financials ? num(v) : 0);
  const manualFor = (costId: string) => {
    const manual: Record<string, number> = {};
    for (const a of allocations) if (a.cost_line_id === costId) manual[String(a.shipment_line_id)] = money(a.amount_azn);
    return manual;
  };
  return {
    id: String(header.id),
    number: str(header.number),
    status: pick(header.status, SHIPMENT_STATUSES, "draft"),
    supplierId: str(header.supplier_id),
    currencyCode: isImportCurrency(header.currency_code) ? header.currency_code : "USD",
    invoiceNo: str(header.invoice_no),
    invoiceDate: str(header.invoice_date),
    invoiceRate: num(header.invoice_rate, 1),
    incoterm: typeof header.incoterm === "string" && (INCOTERMS as readonly string[]).includes(header.incoterm) ? (header.incoterm as Incoterm) : null,
    customsDeclarationNo: str(header.customs_declaration_no),
    customsDeclarationDate: str(header.customs_declaration_date),
    customsRate: numOrNull(header.customs_rate),
    defaultWarehouseId: str(header.default_warehouse_id),
    notes: str(header.notes),
    lines: [...lines]
      .sort((a, b) => num(a.position) - num(b.position))
      .map((l) => ({
        key: String(l.id),
        productId: String(l.product_id),
        qtyPurchase: num(l.qty_purchase_unit),
        purchaseUnit: str(l.purchase_unit),
        qtyStock: num(l.qty_stock_unit),
        unitPriceFc: money(l.unit_price_fc),
        weightKg: numOrNull(l.weight_kg),
        volumeM3: numOrNull(l.volume_m3),
        hsCode: str(l.hs_code),
        dutyRatePct: num(l.duty_rate_pct),
        warehouseId: str(l.warehouse_id),
      })),
    costs: [...costs]
      .sort((a, b) => num(a.position) - num(b.position))
      .map((c) => {
        const method = pick<SplitMethod>(c.split_method, SPLIT_METHODS, "by_value");
        return {
          key: String(c.id),
          costType: pick<CostType>(c.cost_type, COST_TYPES, "other"),
          partnerId: str(c.partner_id),
          description: str(c.description),
          amount: money(c.amount),
          currencyCode: isImportCurrency(c.currency_code) ? c.currency_code : "AZN",
          rateToAzn: num(c.rate_to_azn, 1),
          vatAmountAzn: money(c.vat_amount_azn),
          isCapitalized: c.is_capitalized !== false,
          splitMethod: method,
          isEstimate: c.is_estimate === true,
          paidNow: c.paid_now === true,
          cashAccountId: str(c.cash_account_id),
          manual: method === "manual" ? manualFor(String(c.id)) : {},
        };
      }),
  };
}

export interface ShipmentListRow extends Row {
  id: string;
  number: string;
  status: ShipmentStatus;
  supplier_id: string | null;
  supplier_name: string | null;
  currency_code: string;
  invoice_no: string | null;
  invoice_date: string | null;
  customs_declaration_date: string | null;
  line_count: number;
  /** Goods in the shipment currency; null without financial figures. */
  goods_fc: number | null;
  goods_azn: number | null;
  /** Capitalized costs split onto the lines. */
  costs_azn: number | null;
  landed_azn: number | null;
  vat_azn: number | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string | null;
  updated_at: string | null;
}

const cents = (v: number) => Math.round(v * 100) / 100;

export function shipmentListRows(input: {
  shipments: readonly Row[];
  lines: readonly Row[];
  costs: readonly Row[];
  allocations: readonly Row[];
  suppliers: readonly Row[];
  names: ReadonlyMap<string, string>;
  financials: boolean;
}): ShipmentListRow[] {
  const supplierName = new Map(input.suppliers.map((s) => [String(s.id), String(s.company_name || s.full_name || "")]));
  const costShipment = new Map(input.costs.map((c) => [String(c.id), String(c.shipment_id)]));
  const allocated = new Map<string, number>();
  for (const a of input.allocations) {
    const shipment = costShipment.get(String(a.cost_line_id));
    if (shipment) allocated.set(shipment, (allocated.get(shipment) ?? 0) + num(a.amount_azn));
  }
  return input.shipments.map((s) => {
    const id = String(s.id);
    const lines = input.lines.filter((l) => l.shipment_id === id);
    const goodsFc = lines.reduce((sum, l) => sum + num(l.qty_purchase_unit) * num(l.unit_price_fc), 0);
    const goodsAzn = cents(goodsFc * num(s.invoice_rate, 1));
    const costsAzn = cents(allocated.get(id) ?? 0);
    const vat = input.costs
      .filter((c) => c.shipment_id === id)
      .reduce((sum, c) => sum + num(c.vat_amount_azn) + (c.cost_type === "customs_vat" ? num(c.amount) * num(c.rate_to_azn, 1) : 0), 0);
    const createdBy = str(s.created_by);
    const money = (v: number) => (input.financials ? v : null);
    return {
      id,
      number: String(s.number ?? ""),
      status: pick(s.status, SHIPMENT_STATUSES, "draft"),
      supplier_id: str(s.supplier_id),
      supplier_name: s.supplier_id ? supplierName.get(String(s.supplier_id)) ?? null : null,
      currency_code: String(s.currency_code ?? ""),
      invoice_no: str(s.invoice_no),
      invoice_date: str(s.invoice_date),
      customs_declaration_date: str(s.customs_declaration_date),
      line_count: lines.length,
      goods_fc: money(cents(goodsFc)),
      goods_azn: money(goodsAzn),
      costs_azn: money(costsAzn),
      landed_azn: money(cents(goodsAzn + costsAzn)),
      vat_azn: money(cents(vat)),
      created_by: createdBy,
      created_by_name: createdBy ? input.names.get(createdBy) ?? null : null,
      created_at: str(s.created_at),
      updated_at: str(s.updated_at),
    };
  });
}
