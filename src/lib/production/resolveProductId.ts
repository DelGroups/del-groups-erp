import { isValidUuid } from "@/lib/auth/validate";
import type { Product } from "@/types/database.types";

const PRODUCT_LOOKUP_FIELDS =
  "id,code,name,unit,buy_price,stock,warehouse_id,inventory_mode,barcode";

type ProductLookupClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{ data: unknown; error: { message?: string } | null }>;
        limit: (n: number) => {
          maybeSingle: () => Promise<{ data: unknown; error: { message?: string } | null }>;
        };
      };
      ilike: (column: string, value: string) => {
        limit: (n: number) => {
          maybeSingle: () => Promise<{ data: unknown; error: { message?: string } | null }>;
        };
      };
    };
  };
};

export type ResolveProductionProductInput = {
  product_id?: string | null;
  product_name?: string | null;
  product_code?: string | null;
  warehouse_id?: string | null;
};

export async function resolveProductionProduct(
  admin: ProductLookupClient,
  input: ResolveProductionProductInput
): Promise<{ product: Product } | { error: string }> {
  const direct = input.product_id?.trim() || "";

  if (direct && !isValidUuid(direct)) {
    return {
      error: `Məhsul tapılmadı — Invalid UUID | Product ID: ${direct}`,
    };
  }

  if (direct && isValidUuid(direct)) {
    const { data, error } = await admin
      .from("products")
      .select(PRODUCT_LOOKUP_FIELDS)
      .eq("id", direct)
      .maybeSingle();
    if (error) {
      return { error: `Məhsul sorğusu uğursuz: ${error.message}` };
    }
    if (data) return { product: data as Product };
  }

  const code = input.product_code?.trim();
  if (code) {
    const { data, error } = await admin
      .from("products")
      .select(PRODUCT_LOOKUP_FIELDS)
      .eq("code", code)
      .maybeSingle();
    if (!error && data) return { product: data as Product };
  }

  const name = input.product_name?.trim();
  if (name) {
    const { data, error } = await admin
      .from("products")
      .select(PRODUCT_LOOKUP_FIELDS)
      .ilike("name", name)
      .limit(1)
      .maybeSingle();
    if (!error && data) return { product: data as Product };
  }

  return {
    error: `Məhsul tapılmadı — Product ID: ${direct || "null"} | Name: ${name || "—"} | Code: ${code || "—"}`,
  };
}
