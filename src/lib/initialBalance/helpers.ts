import type { InitialBalanceLineItem } from "@/lib/initialBalance/types";
import { isMetricProduct } from "@/lib/polywood/metricReceive";
import type { Product } from "@/types/database.types";

export function parsePieceLengthsInput(input: string): number[] {
  return input
    .split(/[,;]+/)
    .map((part) => Math.round((parseFloat(part.trim()) || 0) * 1000) / 1000)
    .filter((length) => length > 0);
}

export function formatPieceLengthsInput(lengths: number[]): string {
  return lengths.map((length) => String(length)).join(", ");
}

export function calcInitialBalanceLineTotal(
  item: Pick<InitialBalanceLineItem, "is_metric" | "metric_total_meters" | "quantity" | "unit_cost">
): number {
  const qty = item.is_metric ? item.metric_total_meters : item.quantity;
  return Math.round(qty * item.unit_cost * 100) / 100;
}

export function createEmptyInitialBalanceLine(): InitialBalanceLineItem {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    product_id: "",
    product_code: "",
    product_name: "",
    unit: "Ədəd",
    quantity: 0,
    unit_cost: 0,
    line_total: 0,
    is_metric: false,
    metric_total_meters: 0,
    piece_lengths_input: "",
  };
}

export function applyProductToInitialBalanceLine(
  row: InitialBalanceLineItem,
  product: Product
): InitialBalanceLineItem {
  const metric = isMetricProduct(product);
  const unitCost = Number(product.buy_price) || 0;
  const next: InitialBalanceLineItem = {
    ...row,
    product_id: product.id,
    product_code: product.code || "",
    product_name: product.name,
    unit: metric ? "Metr" : product.unit || "Ədəd",
    is_metric: metric,
    unit_cost: unitCost,
    quantity: metric ? 0 : row.quantity || 0,
    metric_total_meters: metric ? row.metric_total_meters : 0,
    piece_lengths_input: metric ? row.piece_lengths_input : "",
  };
  next.line_total = calcInitialBalanceLineTotal(next);
  return next;
}

export function syncMetricLineFromPieces(row: InitialBalanceLineItem): InitialBalanceLineItem {
  const lengths = parsePieceLengthsInput(row.piece_lengths_input);
  const totalMeters = Math.round(lengths.reduce((sum, length) => sum + length, 0) * 1000) / 1000;
  const next = {
    ...row,
    metric_total_meters: totalMeters,
    quantity: totalMeters,
  };
  next.line_total = calcInitialBalanceLineTotal(next);
  return next;
}
