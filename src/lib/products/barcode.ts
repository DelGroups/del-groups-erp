import { supabase } from "@/lib/supabase";
import type { Product } from "@/types/database.types";

function matchesCode(
  row: { barcode?: string | null; qr_code?: string | null; code?: string | null },
  scanned: string
) {
  const needle = scanned.trim().toLowerCase();
  return [row.barcode, row.qr_code, row.code].some(
    (value) => (value || "").trim().toLowerCase() === needle
  );
}

/** Looks up a product by barcode, QR code, or product code. */
export async function fetchProductByBarcode(barcode: string): Promise<Product | null> {
  const trimmed = barcode.trim();
  if (!trimmed) return null;

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .or(`barcode.eq.${trimmed},qr_code.eq.${trimmed},code.eq.${trimmed}`)
    .limit(1)
    .maybeSingle();

  if (!error && data) return data as Product;

  const { data: piece } = await supabase
    .from("polywood_pieces")
    .select("product_id")
    .or(`barcode.eq.${trimmed},qr_code.eq.${trimmed}`)
    .limit(1)
    .maybeSingle();

  if (piece?.product_id) {
    const { data: product } = await supabase
      .from("products")
      .select("*")
      .eq("id", piece.product_id)
      .maybeSingle();
    return (product as Product) || null;
  }

  if (error) console.error("Barcode lookup error:", error.message);
  return null;
}

export function findCatalogItemByScan<
  T extends { barcode?: string | null; qr_code?: string | null; code?: string | null },
>(items: T[], scanned: string): T | null {
  const trimmed = scanned.trim();
  if (!trimmed) return null;
  return items.find((item) => matchesCode(item, trimmed)) || null;
}

export function findProductByBarcodeInList(
  products: { id: string; barcode?: string | null; qr_code?: string | null; code?: string | null }[],
  barcode: string
): Product | null {
  const hit = findCatalogItemByScan(products, barcode);
  return (hit as Product) || null;
}
