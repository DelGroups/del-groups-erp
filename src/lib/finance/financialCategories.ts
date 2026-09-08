import type { UnifiedTransactionType } from "@/lib/finance/unifiedLedger";
import { isSchemaColumnError } from "@/lib/supabase/schemaFallback";

type DbClient = ReturnType<typeof import("@/lib/supabaseAdmin").createSupabaseAdminClient>;

export type FinancialCategoryRecord = {
  id: string;
  name: string;
  type: UnifiedTransactionType;
  parent_id: string | null;
  is_active: boolean;
};

export type FinancialCategoryTreeNode = FinancialCategoryRecord & {
  children: FinancialCategoryTreeNode[];
};

export type ExpenseCategoryOption = {
  id: string;
  name: string;
  parent_id?: string | null;
  parent_name?: string | null;
};

export const FINANCIAL_CATEGORY_SELECT_ATTEMPTS = [
  "id,name,type,parent_id,is_active",
  "id,name,type,is_active",
] as const;

export function mapFinancialCategoryRow(row: Record<string, unknown>): FinancialCategoryRecord {
  return {
    id: String(row.id),
    name: String(row.name || ""),
    type: String(row.type || "EXPENSE") as UnifiedTransactionType,
    parent_id: (row.parent_id as string) || null,
    is_active: row.is_active !== false,
  };
}

export function buildFinancialCategoryTree(
  rows: FinancialCategoryRecord[]
): FinancialCategoryTreeNode[] {
  const byParent = new Map<string | null, FinancialCategoryRecord[]>();
  for (const row of rows) {
    const key = row.parent_id || null;
    const bucket = byParent.get(key) || [];
    bucket.push(row);
    byParent.set(key, bucket);
  }

  const sortByName = (items: FinancialCategoryRecord[]) =>
    [...items].sort((a, b) => a.name.localeCompare(b.name, "az"));

  const build = (parentId: string | null): FinancialCategoryTreeNode[] =>
    sortByName(byParent.get(parentId) || []).map((row) => ({
      ...row,
      children: build(row.id),
    }));

  return build(null);
}

export function flattenExpenseCategoryOptions(
  rows: FinancialCategoryRecord[]
): ExpenseCategoryOption[] {
  const active = rows.filter((row) => row.is_active && row.type === "EXPENSE");
  const nameById = new Map(active.map((row) => [row.id, row.name]));
  const tree = buildFinancialCategoryTree(active);
  const options: ExpenseCategoryOption[] = [];

  const walk = (nodes: FinancialCategoryTreeNode[], parentName: string | null) => {
    for (const node of nodes) {
      if (node.children.length > 0) {
        walk(node.children, node.name);
      } else {
        options.push({
          id: node.id,
          name: node.name,
          parent_id: node.parent_id,
          parent_name: node.parent_id ? nameById.get(node.parent_id) || parentName : null,
        });
      }
    }
  };

  walk(tree, null);
  return options;
}

export function groupExpenseCategoriesForSelect(rows: ExpenseCategoryOption[]): Array<{
  parentId: string | null;
  parentName: string;
  items: ExpenseCategoryOption[];
}> {
  const parents = new Map<string, { parentName: string; items: ExpenseCategoryOption[] }>();
  const rootItems: ExpenseCategoryOption[] = [];

  for (const row of rows) {
    if (row.parent_id && row.parent_name) {
      const bucket = parents.get(row.parent_id) || {
        parentName: row.parent_name,
        items: [],
      };
      bucket.items.push(row);
      parents.set(row.parent_id, bucket);
    } else {
      rootItems.push(row);
    }
  }

  const groups = Array.from(parents.entries()).map(([parentId, value]) => ({
    parentId,
    parentName: value.parentName,
    items: value.items,
  }));

  if (rootItems.length > 0) {
    groups.unshift({
      parentId: null,
      parentName: "",
      items: rootItems,
    });
  }

  return groups;
}

export async function fetchFinancialCategoryRows(
  admin: DbClient,
  options?: { includeInactive?: boolean; type?: UnifiedTransactionType }
): Promise<{ rows: FinancialCategoryRecord[]; error: string | null }> {
  for (const fields of FINANCIAL_CATEGORY_SELECT_ATTEMPTS) {
    let query = admin.from("financial_categories").select(fields).order("name").limit(500);

    if (options?.type) {
      query = query.eq("type", options.type);
    }

    if (!options?.includeInactive && fields.includes("is_active")) {
      query = query.eq("is_active", true);
    }

    const { data, error } = await query;
    if (!error) {
      return {
        rows: ((data || []) as Record<string, unknown>[]).map(mapFinancialCategoryRow),
        error: null,
      };
    }

    if (!isSchemaColumnError(error.message)) {
      return { rows: [], error: error.message };
    }
  }

  return { rows: [], error: null };
}

export async function fetchActiveExpenseCategoryOptions(
  admin: DbClient
): Promise<ExpenseCategoryOption[]> {
  const { rows, error } = await fetchFinancialCategoryRows(admin, {
    includeInactive: false,
    type: "EXPENSE",
  });

  if (!error && rows.length) {
    return flattenExpenseCategoryOptions(rows);
  }

  const legacy = await admin
    .from("expense_categories")
    .select("id,name,is_active")
    .eq("is_active", true)
    .order("name")
    .limit(200);

  if (!legacy.error && legacy.data?.length) {
    return legacy.data.map((row) => ({
      id: String((row as { id: string }).id),
      name: String((row as { name: string }).name),
    }));
  }

  return [];
}
