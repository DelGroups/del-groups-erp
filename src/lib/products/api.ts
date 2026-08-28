import { supabase } from "@/lib/supabase";
import type { Category, Product, ProductInsert, Warehouse } from "@/types/database.types";
import { generateProductCode } from "@/types/database.types";

/** Normalizes insert payload — products are global; no warehouse_id on this table. */
export function buildProductInsert(
  input: Partial<ProductInsert> & Pick<ProductInsert, "name">
): ProductInsert {
  return {
    code: input.code?.trim() || generateProductCode(),
    name: input.name.trim(),
    category: input.category?.trim() || "Ümumi",
    subcategory: input.subcategory?.trim() || null,
    unit: input.unit || "Ədəd",
    buy_price: Number(input.buy_price) || 0,
    sell_price: Number(input.sell_price) || 0,
    stock: Number(input.stock) || 0,
    min_stock: Number(input.min_stock) || 0,
    barcode: input.barcode?.trim() || null,
    color: input.color?.trim() || null,
    weight: Number(input.weight) || 0,
    extra_info: input.extra_info?.trim() || null,
  };
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
  input: Partial<ProductInsert> & Pick<ProductInsert, "name">
): Promise<{ ok: boolean; error?: string; product?: Product }> {
  const payload = buildProductInsert(input);

  const { data, error } = await supabase.from("products").insert([payload]).select("*").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, product: data as Product };
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
