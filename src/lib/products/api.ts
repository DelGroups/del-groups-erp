import type { PolywoodPieceInsert } from "@/lib/polywood/types";
import { resolveServicesCategoryId } from "@/lib/products/serviceCategory";
import { supabase } from "@/lib/supabase";
import type { Category, Product, ProductInsert, Warehouse } from "@/types/database.types";
import { generateProductCode } from "@/types/database.types";
import { isBarcodeModuleEnabled } from "@/lib/features/barcodeModule";
import { generatePieceBarcode, generateProductBarcode } from "@/lib/products/generateBarcode";

export interface DimensionalOffCutInput {
  length_m: number;
  count: number;
}

export interface DimensionalInitialStockInput {
  warehouseId: string;
  fullSheetCount: number;
  offCuts: DimensionalOffCutInput[];
}

export function calculateDimensionalInitialStockMeters(
  baseLengthM: number,
  fullSheetCount: number,
  offCuts: DimensionalOffCutInput[]
): number {
  const fullTotal = Math.max(0, fullSheetCount) * baseLengthM;
  const cutsTotal = offCuts.reduce(
    (sum, cut) => sum + Math.max(0, cut.length_m) * Math.max(0, Math.floor(cut.count)),
    0
  );
  return Math.round((fullTotal + cutsTotal) * 1000) / 1000;
}

export function buildDimensionalPieceRows(
  productId: string,
  warehouseId: string,
  baseLengthM: number,
  initialStock: DimensionalInitialStockInput
): PolywoodPieceInsert[] {
  const now = new Date().toISOString();
  const rows: PolywoodPieceInsert[] = [];

  for (let i = 0; i < Math.max(0, Math.floor(initialStock.fullSheetCount)); i += 1) {
    const barcode = generatePieceBarcode();
    rows.push({
      product_id: productId,
      warehouse_id: warehouseId,
      length_m: Math.round(baseLengthM * 1000) / 1000,
      piece_type: "full",
      status: "available",
      notes: null,
      sale_item_id: null,
      barcode,
      qr_code: barcode,
      updated_at: now,
    });
  }

  for (const cut of initialStock.offCuts) {
    const lengthM = Math.round(Math.max(0, cut.length_m) * 1000) / 1000;
    const count = Math.max(0, Math.floor(cut.count));
    if (lengthM <= 0 || count <= 0) continue;

    for (let i = 0; i < count; i += 1) {
      const barcode = generatePieceBarcode();
      rows.push({
        product_id: productId,
        warehouse_id: warehouseId,
        length_m: lengthM,
        piece_type: "cut",
        status: "available",
        notes: null,
        sale_item_id: null,
        barcode,
        qr_code: barcode,
        updated_at: now,
      });
    }
  }

  return rows;
}

/** Normalizes insert payload — products are global; no warehouse_id on this table. */
export function buildProductInsert(
  input: Partial<ProductInsert> & Pick<ProductInsert, "name">
): ProductInsert {
  const isDimensional = Boolean(input.is_dimensional);
  const isService = Boolean(input.is_service);
  const trimmedBarcode = input.barcode?.trim() || "";
  const barcode = isBarcodeModuleEnabled()
    ? trimmedBarcode || generateProductBarcode()
    : trimmedBarcode || null;
  const trimmedQr = input.qr_code?.trim() || "";
  const qrCode = isBarcodeModuleEnabled() ? trimmedQr || barcode : trimmedQr || null;
  return {
    code: input.code?.trim() || generateProductCode(),
    name: input.name.trim(),
    category: input.category?.trim() || "Ümumi",
    subcategory: input.subcategory?.trim() || null,
    unit: input.unit || "Ədəd",
    buy_price: Number(input.buy_price) || 0,
    buy_price_cut: Number(input.buy_price_cut) || 0,
    sell_price: Number(input.sell_price) || 0,
    sell_price_cut: Number(input.sell_price_cut) || 0,
    price_wholesale: input.price_wholesale != null ? Number(input.price_wholesale) || null : null,
    price_distributor: input.price_distributor != null ? Number(input.price_distributor) || null : null,
    buy_price_wholesale:
      input.buy_price_wholesale != null ? Number(input.buy_price_wholesale) || null : null,
    buy_price_distributor:
      input.buy_price_distributor != null ? Number(input.buy_price_distributor) || null : null,
    stock: isService ? 0 : Number(input.stock) || 0,
    min_stock: isService ? 0 : Number(input.min_stock) || 0,
    min_stock_level: isService ? 0 : Number(input.min_stock_level ?? input.min_stock) || 0,
    barcode,
    qr_code: qrCode,
    image_url: input.image_url?.trim() || null,
    brand: input.brand?.trim() || null,
    country_of_origin: input.country_of_origin?.trim() || null,
    mfg_date: input.mfg_date?.trim() || null,
    exp_date: input.exp_date?.trim() || null,
    extra_info: input.extra_info?.trim() || null,
    category_id: input.category_id?.trim() || null,
    is_dimensional: isDimensional,
    is_service: isService,
    is_composite: Boolean(input.is_composite) && !isService,
    parent_id: input.parent_id?.trim() || null,
    base_length: isDimensional && input.base_length ? Number(input.base_length) || null : null,
    base_width: isDimensional && input.base_width ? Number(input.base_width) || null : null,
  };
}

export async function findOrCreateServiceProduct(
  name: string,
  sellPrice = 0,
  categories: Category[] = []
): Promise<{ ok: boolean; error?: string; product?: Product }> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Service name is required" };

  const { data: existing, error: lookupError } = await supabase
    .from("products")
    .select("*")
    .ilike("name", trimmed)
    .maybeSingle();

  if (lookupError) return { ok: false, error: lookupError.message };
  if (existing) return { ok: true, product: existing as Product };

  const categoryId = resolveServicesCategoryId(categories);
  return createProduct({
    name: trimmed,
    category: "Services",
    subcategory: "Services",
    category_id: categoryId,
    unit: "Xidmət",
    buy_price: 0,
    sell_price: sellPrice,
    stock: 0,
    min_stock: 0,
    min_stock_level: 0,
    is_service: true,
    is_dimensional: false,
  });
}

export async function fetchProductsCatalog(): Promise<{
  products: Product[];
  categories: Category[];
  warehouses: Warehouse[];
}> {
  const [
    { data: products, error: productsError },
    { data: categories, error: categoriesError },
    { data: warehouses, error: warehousesError },
  ] =
    await Promise.all([
      supabase.from("products").select("*").order("created_at", { ascending: false }),
      supabase.from("categories").select("*").order("name", { ascending: true }),
      supabase.from("warehouses").select("*").order("created_at", { ascending: true }),
    ]);

  if (productsError) throw new Error(productsError.message);
  if (categoriesError) throw new Error(categoriesError.message);
  if (warehousesError) throw new Error(warehousesError.message);

  return {
    products: (products as Product[]) || [],
    categories: (categories as Category[]) || [],
    warehouses: (warehouses as Warehouse[]) || [],
  };
}

export async function createProduct(
  input: Partial<ProductInsert> & Pick<ProductInsert, "name">,
  dimensionalInitialStock?: DimensionalInitialStockInput | null
): Promise<{ ok: boolean; error?: string; product?: Product }> {
  const { createProductWithRelations } = await import("@/lib/products/createProductService");
  const result = await createProductWithRelations({
    product: input,
    dimensionalInitialStock,
  });
  return {
    ok: result.ok,
    error: result.error,
    product: result.product,
  };
}

export async function createCategory(
  name: string,
  parentId: string | null
): Promise<{ ok: boolean; error?: string; category?: Category }> {
  const { data, error } = await supabase
    .from("categories")
    .insert([{ name: name.trim(), parent_id: parentId || null }])
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, category: data as Category };
}

export async function updateCategory(
  id: string,
  patch: { name: string; parent_id: string | null }
): Promise<{ ok: boolean; error?: string; category?: Category }> {
  const { data, error } = await supabase
    .from("categories")
    .update({
      name: patch.name.trim(),
      parent_id: patch.parent_id || null,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, category: data as Category };
}

export async function deleteCategory(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function updateProduct(
  id: string,
  input: Partial<ProductInsert> & Pick<ProductInsert, "name">
): Promise<{ ok: boolean; error?: string; product?: Product }> {
  const payload = buildProductInsert(input);
  const { data, error } = await supabase
    .from("products")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, product: data as Product };
}

export function getCategoryFullName(categories: Category[], cat: Category): string {
  if (!cat.parent_id) return cat.name;
  const parent = categories.find((c) => c.id === cat.parent_id);
  return parent ? `${parent.name} ➔ ${cat.name}` : cat.name;
}
