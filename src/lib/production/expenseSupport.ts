import {
  FINANCIAL_CATEGORY_SELECT_ATTEMPTS,
  flattenExpenseCategoryOptions,
  mapFinancialCategoryRow,
  type ExpenseCategoryOption,
} from "@/lib/finance/financialCategories";
import { PRODUCTION_EXPENSE_CATEGORIES } from "@/lib/production/types";

type DbClient = ReturnType<typeof import("@/lib/supabaseAdmin").createSupabaseAdminClient>;

export type { ExpenseCategoryOption };

export type ProductionPartyOption = {
  id: string;
  label: string;
  group: "internal" | "external";
};

const FALLBACK_EXPENSE_CATEGORIES: ExpenseCategoryOption[] = [
  { id: "transport", name: "Nəqliyyat" },
  { id: "delivery", name: "Çatdırılma" },
  { id: "installation", name: "Quraşdırma" },
  { id: "tools", name: "Alət / Material" },
  { id: "other", name: "Digər" },
];

function isMasterEmployee(row: {
  position?: string | null;
  role?: string | null;
  department?: string | null;
}): boolean {
  const position = String(row.position || "").toLowerCase();
  const role = String(row.role || "").toLowerCase();
  const department = String(row.department || "").toLowerCase();
  return (
    position.includes("usta") ||
    role === "usta" ||
    role.includes("usta") ||
    department.includes("usta")
  );
}

function isExternalContractor(row: Record<string, unknown>): boolean {
  const type = String(row.type || row.supplier_type || "").toLowerCase();
  if (row.is_contractor === true) return true;
  return type === "contractor" || type.includes("podrat");
}

export async function fetchActiveExpenseCategories(
  admin: DbClient
): Promise<ExpenseCategoryOption[]> {
  for (const fields of FINANCIAL_CATEGORY_SELECT_ATTEMPTS) {
    let query = admin
      .from("financial_categories")
      .select(fields)
      .eq("type", "EXPENSE")
      .order("name")
      .limit(500);

    if (fields.includes("is_active")) {
      query = query.eq("is_active", true);
    }

    const { data, error } = await query;
    if (!error && data?.length) {
      return flattenExpenseCategoryOptions(
        (data as Record<string, unknown>[]).map(mapFinancialCategoryRow)
      );
    }

    if (!/column|schema cache/i.test(error?.message || "")) break;
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

  return FALLBACK_EXPENSE_CATEGORIES;
}

export async function fetchProductionPartyOptions(
  admin: DbClient
): Promise<ProductionPartyOption[]> {
  const [employeesRes, suppliersRes] = await Promise.all([
    admin
      .from("employees")
      .select("id,full_name,position,role,department,status")
      .eq("status", "active")
      .order("full_name")
      .limit(250),
    admin
      .from("suppliers")
      .select("id,full_name,company_name,type,is_contractor,supplier_type")
      .order("full_name")
      .limit(250),
  ]);

  let employees = (employeesRes.data || []) as {
    id: string;
    full_name: string;
    position?: string | null;
    role?: string | null;
    department?: string | null;
  }[];

  if (employeesRes.error) {
    const fallback = await admin
      .from("employees")
      .select("id,full_name,position,role,department")
      .order("full_name")
      .limit(250);
    employees = (fallback.data || []) as typeof employees;
  }

  let suppliers = (suppliersRes.data || []) as Record<string, unknown>[];
  if (suppliersRes.error) {
    const fallback = await admin
      .from("suppliers")
      .select("id,full_name,company_name")
      .order("full_name")
      .limit(250);
    suppliers = (fallback.data || []) as Record<string, unknown>[];
  }

  const internalMasters = employees
    .filter(isMasterEmployee)
    .map((row) => ({
      id: `employee:${row.id}`,
      label: row.full_name,
      group: "internal" as const,
    }));

  const contractorCandidates = suppliers.filter(isExternalContractor);
  const externalRows = contractorCandidates.length ? contractorCandidates : suppliers;

  const externalContractors = externalRows.map((row) => ({
    id: `supplier:${String(row.id)}`,
    label: String(row.company_name || row.full_name || "Podratçı"),
    group: "external" as const,
  }));

  return [...internalMasters, ...externalContractors];
}

export function resolveExpenseCategoryName(
  category: string,
  categories: ExpenseCategoryOption[]
): string {
  const match = categories.find((row) => row.id === category || row.name === category);
  if (!match) return category;
  if (match.parent_name) return `${match.parent_name} / ${match.name}`;
  return match.name;
}

const LEGACY_EXPENSE_CATEGORY_SLUGS = new Set([
  "transport",
  "delivery",
  "installation",
  "tools",
  "other",
]);

const FINANCIAL_CATEGORY_SLUG_MAP: Record<string, string> = {
  nəqliyyat: "transport",
  neqliyyat: "transport",
  çatdırılma: "delivery",
  catdirilma: "delivery",
  quraşdırma: "installation",
  qurasdirma: "installation",
  "alət / material": "tools",
  "alet / material": "tools",
  alət: "tools",
  alet: "tools",
  material: "tools",
  digər: "other",
  diger: "other",
};

function normalizeCategoryKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function resolveProductionExpenseCategoryStorage(
  categoryName: string,
  categoryId?: string | null
): string {
  const raw = String(categoryName || categoryId || "").trim();
  if (!raw) return "other";
  if (LEGACY_EXPENSE_CATEGORY_SLUGS.has(raw)) return raw;
  const mapped = FINANCIAL_CATEGORY_SLUG_MAP[normalizeCategoryKey(raw)];
  if (mapped) return mapped;
  return raw;
}

export function parseProductionPartyRef(
  partyId?: string | null
): { entityType: "employee" | "supplier"; entityId: string } | null {
  const value = String(partyId || "").trim();
  if (!value) return null;
  const [entityType, entityId] = value.split(":");
  if (entityType === "employee" && entityId) {
    return { entityType: "employee", entityId };
  }
  if (entityType === "supplier" && entityId) {
    return { entityType: "supplier", entityId };
  }
  return null;
}

export function buildProductionExpenseNotes(
  description: string,
  contractorLabel?: string | null,
  extraNotes?: string | null
): string {
  const lines = [description.trim()];
  if (contractorLabel?.trim()) {
    lines.push(`Podratçı: ${contractorLabel.trim()}`);
  }
  if (extraNotes?.trim()) {
    lines.push(extraNotes.trim());
  }
  return lines.filter(Boolean).join("\n");
}

export function parseProductionExpenseNotes(notes: string | null | undefined): {
  description: string;
  contractor: string | null;
} {
  const text = String(notes || "").trim();
  if (!text) return { description: "", contractor: null };

  const contractorMatch = text.match(/(?:^|\n)Podratçı:\s*(.+)$/im);
  const contractor = contractorMatch?.[1]?.trim() || null;
  const description = text
    .replace(/(?:^|\n)Podratçı:\s*.+$/im, "")
    .trim();

  return {
    description: description || text,
    contractor,
  };
}

export function isKnownProductionExpenseCategory(value: string): boolean {
  return (PRODUCTION_EXPENSE_CATEGORIES as readonly string[]).includes(value);
}
