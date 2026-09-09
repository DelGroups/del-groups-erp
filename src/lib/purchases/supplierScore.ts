import type { Supplier } from "@/types/database.types";
import {
  DEFAULT_PROCUREMENT_CONFIG,
  type ProcurementConfig,
} from "@/lib/procurement/config";

export function supplierDisplayName(supplier: Supplier): string {
  return supplier.full_name || supplier.company_name || supplier.code || "—";
}

export function formatSupplierScore(score: number | null | undefined): string {
  const value = Number(score);
  if (!Number.isFinite(value) || value <= 0) return "—";
  return value.toFixed(1);
}

function ratedValue(score: number | null | undefined): number | null {
  const value = Number(score);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/** Weighted 1–5 total. Missing components are skipped and remaining weights renormalized. */
export function weightedSupplierScore(
  supplier: Supplier,
  config: ProcurementConfig = DEFAULT_PROCUREMENT_CONFIG,
  priceScore?: number | null
): number | null {
  const parts: Array<{ score: number; weight: number }> = [];
  const quality = ratedValue(supplier.quality_score);
  const speed = ratedValue(supplier.delivery_speed_score);
  const price = ratedValue(priceScore);

  if (quality != null && config.quality_weight > 0) {
    parts.push({ score: quality, weight: config.quality_weight });
  }
  if (speed != null && config.delivery_speed_weight > 0) {
    parts.push({ score: speed, weight: config.delivery_speed_weight });
  }
  if (price != null && config.price_weight > 0) {
    parts.push({ score: price, weight: config.price_weight });
  }

  const den = parts.reduce((sum, part) => sum + part.weight, 0);
  if (den <= 0) return null;
  const num = parts.reduce((sum, part) => sum + part.score * part.weight, 0);
  return Math.round((num / den) * 100) / 100;
}

export function formatSupplierOptionLabel(
  supplier: Supplier,
  config: ProcurementConfig = DEFAULT_PROCUREMENT_CONFIG
): string {
  const name = supplierDisplayName(supplier);
  const total = weightedSupplierScore(supplier, config);
  if (total == null) {
    const quality = Number(supplier.quality_score);
    const speed = Number(supplier.delivery_speed_score);
    if (!Number.isFinite(quality) && !Number.isFinite(speed)) {
      return name;
    }
    const q = formatSupplierScore(supplier.quality_score);
    const s = formatSupplierScore(supplier.delivery_speed_score);
    return `${name}  ★${q} / ${s}`;
  }
  return `${name}  ★${total.toFixed(1)}`;
}
