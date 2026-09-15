import type { Category } from "@/types/database.types";

function normalizeHint(value: string): string {
  return value
    .toLowerCase()
    .replace(/^en:/, "")
    .replace(/-/g, " ")
    .trim();
}

/** Map a global barcode category hint to the closest local parent category name. */
export function resolveCategoryFromHint(
  categoryHint: string | null | undefined,
  categories: Category[]
): string {
  const parents = categories.filter((row) => !row.parent_id);
  const fallback =
    parents.find((row) => row.name === "Ümumi")?.name || parents[0]?.name || "Ümumi";
  if (!categoryHint?.trim()) return fallback;

  const primary = normalizeHint(categoryHint.split(",")[0] ?? categoryHint);
  const hit = parents.find((row) => {
    const local = row.name.toLowerCase();
    return primary.includes(local) || local.includes(primary);
  });
  return hit?.name || fallback;
}
