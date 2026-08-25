import { supabase } from "@/lib/supabase";
import type { Product } from "@/types/database.types";

/** Looks up a product by exact barcode match in the products table. */
export async function fetchProductByBarcode(barcode: string): Promise<Product | null> {
  const trimmed = barcode.trim();
  if (!trimmed) return null;

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("barcode", trimmed)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Barcode lookup error:", error.message);
    return null;
  }

  return (data as Product) || null;
}

export function findProductByBarcodeInList(
  products: { id: string; barcode?: string | null }[],
  barcode: string
): Product | null {
  const trimmed = barcode.trim().toLowerCase();
  if (!trimmed) return null;
  const hit = products.find((p) => (p.barcode || "").trim().toLowerCase() === trimmed);
  return (hit as Product) || null;
}
