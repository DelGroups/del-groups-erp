import { PRODUCTION_EXPENSE_CATEGORIES } from "@/lib/production/types";

type DbClient = ReturnType<typeof import("@/lib/supabaseAdmin").createSupabaseAdminClient>;

export type ExpenseCategoryOption = {
  id: string;
  name: string;
};

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
  const { data, error } = await admin
    .from("financial_categories")
    .select("id,name,type,is_active")
    .eq("type", "EXPENSE")
    .eq("is_active", true)
    .order("name")
    .limit(200);

  if (!error && data?.length) {
    return data.map((row) => ({
      id: String((row as { id: string }).id),
      name: String((row as { name: string }).name),
    }));
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
  return match?.name || category;
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
