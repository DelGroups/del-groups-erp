import type { SupabaseClient } from "@supabase/supabase-js";

function slugifyName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "item";
}

async function uniqueCategorySlug(
  admin: SupabaseClient,
  baseSlug: string
): Promise<string> {
  let candidate = baseSlug;
  let suffix = 2;
  while (true) {
    const { data } = await admin
      .from("categories")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (!data) return candidate;
    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
}

async function uniqueSubCategorySlug(
  admin: SupabaseClient,
  categoryId: string,
  baseSlug: string
): Promise<string> {
  let candidate = baseSlug;
  let suffix = 2;
  while (true) {
    const { data } = await admin
      .from("sub_categories")
      .select("id")
      .eq("category_id", categoryId)
      .eq("slug", candidate)
      .maybeSingle();
    if (!data) return candidate;
    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
}

export async function resolveOrCreateCategory(
  admin: SupabaseClient,
  rawName: string
): Promise<{ id: string; name: string }> {
  const name = rawName.trim() || "Polywood";
  const slug = slugifyName(name);

  const { data: bySlug } = await admin
    .from("categories")
    .select("id, name")
    .eq("slug", slug)
    .maybeSingle();
  if (bySlug?.id) return { id: bySlug.id as string, name: bySlug.name as string };

  const { data: byName } = await admin
    .from("categories")
    .select("id, name, slug")
    .ilike("name", name)
    .is("parent_id", null)
    .maybeSingle();
  if (byName?.id) {
    if (!byName.slug) {
      await admin.from("categories").update({ slug }).eq("id", byName.id);
    }
    return { id: byName.id as string, name: byName.name as string };
  }

  const uniqueSlug = await uniqueCategorySlug(admin, slug);
  const { data: created, error } = await admin
    .from("categories")
    .insert([{ name, slug: uniqueSlug, parent_id: null }])
    .select("id, name")
    .single();

  if (error || !created) {
    throw new Error(error?.message || `Kateqoriya yaradılmadı: ${name}`);
  }

  return { id: created.id as string, name: created.name as string };
}

export async function resolveOrCreateSubCategory(
  admin: SupabaseClient,
  categoryId: string,
  rawName: string
): Promise<{ id: string; name: string } | null> {
  const name = rawName.trim();
  if (!name) return null;

  const slug = slugifyName(name);

  const { data: bySlug } = await admin
    .from("sub_categories")
    .select("id, name")
    .eq("category_id", categoryId)
    .eq("slug", slug)
    .maybeSingle();
  if (bySlug?.id) return { id: bySlug.id as string, name: bySlug.name as string };

  const { data: byName } = await admin
    .from("sub_categories")
    .select("id, name")
    .eq("category_id", categoryId)
    .ilike("name", name)
    .maybeSingle();
  if (byName?.id) return { id: byName.id as string, name: byName.name as string };

  const uniqueSlug = await uniqueSubCategorySlug(admin, categoryId, slug);
  const { data: created, error } = await admin
    .from("sub_categories")
    .insert([{ category_id: categoryId, name, slug: uniqueSlug }])
    .select("id, name")
    .single();

  if (error || !created) {
    throw new Error(error?.message || `Alt kateqoriya yaradılmadı: ${name}`);
  }

  return { id: created.id as string, name: created.name as string };
}
