import type { Supplier } from "@/types/database.types";

export function supplierDisplayName(supplier: Supplier): string {
  return supplier.full_name || supplier.company_name || supplier.code || "—";
}

export function formatSupplierScore(score: number | null | undefined): string {
  const value = Number(score);
  if (!Number.isFinite(value) || value <= 0) return "—";
  return value.toFixed(1);
}

export function formatSupplierOptionLabel(supplier: Supplier): string {
  const name = supplierDisplayName(supplier);
  const quality = Number(supplier.quality_score);
  const speed = Number(supplier.delivery_speed_score);
  if (!Number.isFinite(quality) && !Number.isFinite(speed)) {
    return name;
  }
  const q = formatSupplierScore(supplier.quality_score);
  const s = formatSupplierScore(supplier.delivery_speed_score);
  return `${name}  ★${q} / ${s}`;
}
