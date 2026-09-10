export type InventoryTurnoverRow = {
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  categoryId: string | null;
  categoryName: string;
  initialQty: number;
  initialValue: number;
  inboundQty: number;
  inboundValue: number;
  outboundQty: number;
  outboundValue: number;
  closingQty: number;
  closingValue: number;
};

export type InventoryTurnoverTotals = {
  initialQty: number;
  initialValue: number;
  inboundQty: number;
  inboundValue: number;
  outboundQty: number;
  outboundValue: number;
  closingQty: number;
  closingValue: number;
};

export type InventoryTurnoverReport = {
  startDate: string;
  endDate: string;
  categoryId: string | null;
  rows: InventoryTurnoverRow[];
  totals: InventoryTurnoverTotals;
};

function toAmount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function mapInventoryTurnover(payload: unknown): InventoryTurnoverReport {
  const data = (payload || {}) as Record<string, unknown>;
  const rowsRaw = Array.isArray(data.rows) ? data.rows : [];
  const totalsRaw = (data.totals || {}) as Record<string, unknown>;

  const rows: InventoryTurnoverRow[] = rowsRaw.map((row) => {
    const item = row as Record<string, unknown>;
    return {
      productId: String(item.product_id || ""),
      productCode: String(item.product_code || ""),
      productName: String(item.product_name || ""),
      unit: String(item.unit || ""),
      categoryId: typeof item.category_id === "string" ? item.category_id : null,
      categoryName: String(item.category_name || ""),
      initialQty: toAmount(item.initial_qty),
      initialValue: toAmount(item.initial_value),
      inboundQty: toAmount(item.inbound_qty),
      inboundValue: toAmount(item.inbound_value),
      outboundQty: toAmount(item.outbound_qty),
      outboundValue: toAmount(item.outbound_value),
      closingQty: toAmount(item.closing_qty),
      closingValue: toAmount(item.closing_value),
    };
  });

  return {
    startDate: String(data.start_date || ""),
    endDate: String(data.end_date || ""),
    categoryId: typeof data.category_id === "string" ? data.category_id : null,
    rows,
    totals: {
      initialQty: toAmount(totalsRaw.initial_qty),
      initialValue: toAmount(totalsRaw.initial_value),
      inboundQty: toAmount(totalsRaw.inbound_qty),
      inboundValue: toAmount(totalsRaw.inbound_value),
      outboundQty: toAmount(totalsRaw.outbound_qty),
      outboundValue: toAmount(totalsRaw.outbound_value),
      closingQty: toAmount(totalsRaw.closing_qty),
      closingValue: toAmount(totalsRaw.closing_value),
    },
  };
}
