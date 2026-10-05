"use server";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createSupabaseServerClient, getServerAuthContext } from "@/lib/supabaseServer";
import {
  ActionAuthError,
  mapRpcError,
  type ActionAuthContext,
} from "@/lib/auth/serverActionAuth";
import { filterAccountsByScope, resolveEffectiveAccess } from "@/lib/auth/permissionMatrix";
import { userHasPermission } from "@/lib/auth/routePermissions";
import { clampString, isValidUuid } from "@/lib/auth/validate";
import {
  fetchFinancialCategoryRows,
  flattenExpenseCategoryOptions,
  type ExpenseCategoryOption,
} from "@/lib/finance/financialCategories";
import {
  EXPENSE_STATUSES,
  summarizeExpenses,
  type ExpenseDocument,
  type ExpenseFilters,
  type ExpenseSaveInput,
  type ExpenseStatus,
  type ExpenseSummary,
} from "@/lib/expenses/expenseDocuments";
import type { PermissionKey } from "@/types/database.types";
import type { ActionResult } from "@/lib/supabase/actionResult";

export interface ExpenseAccountOption {
  id: string;
  name: string;
  balance: number;
}

export interface ExpenseNamedOption {
  id: string;
  name: string;
}

export interface ExpenseFormOptions {
  accounts: ExpenseAccountOption[];
  categories: ExpenseCategoryOption[];
  suppliers: ExpenseNamedOption[];
  departments: ExpenseNamedOption[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS = 2000;

async function requireAnyExpensePermission(
  ...permissions: PermissionKey[]
): Promise<ActionAuthContext> {
  const { user, profile } = await getServerAuthContext();
  if (!user) throw new ActionAuthError("Giriş tələb olunur");
  if (profile?.is_active === false) {
    throw new ActionAuthError("Hesabınız deaktiv edilib. Administratorla əlaqə saxlayın.");
  }
  if (permissions.some((permission) => userHasPermission(profile, permission))) {
    return { user, profile };
  }
  throw new ActionAuthError("İcazəniz yoxdur");
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function supplierLabel(row: Record<string, unknown>): string {
  const company = String(row.company_name || "").trim();
  const person = String(row.full_name || "").trim();
  return company || person || String(row.code || "");
}

function actionError(err: unknown, fallback: string): { success: false; error: string } {
  if (err instanceof ActionAuthError) return { success: false, error: err.message };
  return { success: false, error: err instanceof Error ? err.message : fallback };
}

export async function fetchExpenseFormOptionsAction(): Promise<ActionResult<ExpenseFormOptions>> {
  try {
    const { profile } = await requireAnyExpensePermission(
      "can_view_expenses",
      "can_manage_expenses",
      "can_manage_finance"
    );
    const admin = createSupabaseAdminClient();

    const [accountsRes, categoriesRes, suppliersRes, departmentsRes] = await Promise.all([
      admin.from("accounts").select("id,name,balance").order("name"),
      fetchFinancialCategoryRows(admin, { includeInactive: false }),
      admin.from("suppliers").select("id,code,full_name,company_name").order("full_name").limit(1000),
      admin
        .from("employee_departments" as never)
        .select("id,name,is_active,sort_order")
        .order("sort_order"),
    ]);

    if (accountsRes.error) return { success: false, error: accountsRes.error.message };
    if (categoriesRes.error) return { success: false, error: categoriesRes.error };

    const access = resolveEffectiveAccess(profile);
    const accounts = filterAccountsByScope(
      ((accountsRes.data || []) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id),
        name: String(row.name || ""),
        balance: toNumber(row.balance),
      })),
      access.scopes
    );

    const suppliers = ((suppliersRes.data || []) as Array<Record<string, unknown>>)
      .map((row) => ({ id: String(row.id), name: supplierLabel(row) }))
      .filter((row) => row.name)
      .sort((a, b) => a.name.localeCompare(b.name, "az"));

    const departments = ((departmentsRes.data || []) as Array<Record<string, unknown>>)
      .filter((row) => row.is_active !== false)
      .map((row) => ({ id: String(row.id), name: String(row.name || "") }));

    return {
      success: true,
      data: {
        accounts,
        categories: flattenExpenseCategoryOptions(categoriesRes.rows),
        suppliers,
        departments,
      },
    };
  } catch (err) {
    return actionError(err, "Seçimlər yüklənmədi");
  }
}

export async function fetchExpensesAction(
  filters: ExpenseFilters = {}
): Promise<ActionResult<{ rows: ExpenseDocument[]; summary: ExpenseSummary; truncated: boolean }>> {
  try {
    const { profile } = await requireAnyExpensePermission("can_view_expenses", "can_manage_expenses");
    const client = await createSupabaseServerClient();

    let query = client
      .from("expenses")
      .select(
        "id,code,expense_date,status,category_id,category,account_id,supplier_id,payee,reference_no," +
          "description,notes,department_id,production_order_id,net_amount,vat_rate,vat_amount,amount," +
          "cancel_reason,created_at"
      )
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS + 1);

    if (filters.from && ISO_DATE.test(filters.from)) query = query.gte("expense_date", filters.from);
    if (filters.to && ISO_DATE.test(filters.to)) query = query.lte("expense_date", filters.to);
    if (filters.categoryId && isValidUuid(filters.categoryId)) {
      query = query.eq("category_id", filters.categoryId);
    }
    if (filters.accountId && isValidUuid(filters.accountId)) {
      query = query.eq("account_id", filters.accountId);
    }
    if (filters.supplierId && isValidUuid(filters.supplierId)) {
      query = query.eq("supplier_id", filters.supplierId);
    }
    if (filters.departmentId && isValidUuid(filters.departmentId)) {
      query = query.eq("department_id", filters.departmentId);
    }
    if (filters.status && EXPENSE_STATUSES.includes(filters.status)) {
      query = query.eq("status", filters.status);
    }

    const { data, error } = await query;
    if (error) return { success: false, error: error.message };

    const raw = (data || []) as unknown as Array<Record<string, unknown>>;
    const truncated = raw.length > MAX_ROWS;
    const rows = truncated ? raw.slice(0, MAX_ROWS) : raw;

    const ids = (key: string) =>
      Array.from(new Set(rows.map((r) => r[key]).filter((v): v is string => typeof v === "string")));

    const admin = createSupabaseAdminClient();
    const accountIds = ids("account_id");
    const supplierIds = ids("supplier_id");
    const departmentIds = ids("department_id");
    const expenseIds = rows.map((r) => String(r.id));

    const [accountsRes, suppliersRes, departmentsRes, productionRes] = await Promise.all([
      accountIds.length
        ? admin.from("accounts").select("id,name").in("id", accountIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      supplierIds.length
        ? admin.from("suppliers").select("id,code,full_name,company_name").in("id", supplierIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      departmentIds.length
        ? admin.from("employee_departments" as never).select("id,name").in("id", departmentIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      expenseIds.length
        ? admin
            .from("production_expenses" as never)
            .select("finance_expense_id")
            .in("finance_expense_id", expenseIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    ]);

    const nameMap = (list: unknown, label: (row: Record<string, unknown>) => string) =>
      new Map(((list || []) as Array<Record<string, unknown>>).map((row) => [String(row.id), label(row)]));
    const accountNames = nameMap(accountsRes.data, (row) => String(row.name || ""));
    const supplierNames = nameMap(suppliersRes.data, supplierLabel);
    const departmentNames = nameMap(departmentsRes.data, (row) => String(row.name || ""));
    const productionIds = new Set(
      ((productionRes.data || []) as Array<Record<string, unknown>>).map((row) =>
        String(row.finance_expense_id)
      )
    );

    let mapped: ExpenseDocument[] = rows.map((row) => {
      const amount = toNumber(row.amount);
      const vat = toNumber(row.vat_amount);
      return {
        id: String(row.id),
        code: String(row.code || ""),
        expense_date: String(row.expense_date || "").slice(0, 10),
        status: (String(row.status || "posted") as ExpenseStatus),
        category_id: (row.category_id as string) || null,
        category: String(row.category || ""),
        account_id: (row.account_id as string) || null,
        account_name: row.account_id ? accountNames.get(String(row.account_id)) || null : null,
        supplier_id: (row.supplier_id as string) || null,
        supplier_name: row.supplier_id ? supplierNames.get(String(row.supplier_id)) || null : null,
        payee: (row.payee as string) || null,
        reference_no: (row.reference_no as string) || null,
        description: (row.description as string) || null,
        notes: (row.notes as string) || null,
        department_id: (row.department_id as string) || null,
        department_name: row.department_id
          ? departmentNames.get(String(row.department_id)) || null
          : null,
        production_order_id: (row.production_order_id as string) || null,
        net_amount: row.net_amount == null ? amount - vat : toNumber(row.net_amount),
        vat_rate: toNumber(row.vat_rate),
        vat_amount: vat,
        amount,
        cancel_reason: (row.cancel_reason as string) || null,
        created_at: (row.created_at as string) || null,
        is_production: productionIds.has(String(row.id)),
      };
    });

    const access = resolveEffectiveAccess(profile);
    if (!access.isAdmin && access.scopes.allowed_financial_accounts.length > 0) {
      const allowed = new Set(access.scopes.allowed_financial_accounts);
      mapped = mapped.filter((row) => !row.account_id || allowed.has(row.account_id));
    }

    const search = filters.search?.trim().toLocaleLowerCase("az");
    if (search) {
      mapped = mapped.filter((row) =>
        [
          row.code,
          row.category,
          row.supplier_name,
          row.payee,
          row.reference_no,
          row.description,
          row.notes,
          row.account_name,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase("az").includes(search))
      );
    }

    return { success: true, data: { rows: mapped, summary: summarizeExpenses(mapped), truncated } };
  } catch (err) {
    return actionError(err, "Xərclər yüklənmədi");
  }
}

export async function saveExpenseAction(
  input: ExpenseSaveInput
): Promise<ActionResult<{ id: string; code: string; status: ExpenseStatus }>> {
  try {
    await requireAnyExpensePermission("can_manage_expenses");

    const expenseDate = String(input.expenseDate || "").trim();
    if (!ISO_DATE.test(expenseDate)) return { success: false, error: "Xərc tarixi düzgün deyil" };
    if (!isValidUuid(input.categoryId)) return { success: false, error: "Xərc kateqoriyası seçilməlidir" };
    if (input.post && !isValidUuid(input.accountId)) {
      return { success: false, error: "Kassa/bank hesabı seçilməlidir" };
    }
    const net = Number(input.netAmount);
    if (!Number.isFinite(net) || net <= 0) {
      return { success: false, error: "Məbləğ sıfırdan böyük olmalıdır" };
    }
    const vatRate = Number(input.vatRate ?? 0);
    if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
      return { success: false, error: "ƏDV dərəcəsi 0–100 arasında olmalıdır" };
    }
    const vatAmount = input.vatAmount == null ? null : Number(input.vatAmount);
    if (vatAmount != null && (!Number.isFinite(vatAmount) || vatAmount < 0)) {
      return { success: false, error: "ƏDV məbləği mənfi ola bilməz" };
    }

    const optionalUuid = (value?: string) => (value && isValidUuid(value) ? value : null);

    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("record_expense_atomic", {
      p_payload: {
        id: optionalUuid(input.id),
        expense_date: expenseDate,
        category_id: input.categoryId,
        account_id: optionalUuid(input.accountId),
        supplier_id: optionalUuid(input.supplierId),
        payee: clampString(input.payee ?? "", 200) || null,
        reference_no: clampString(input.referenceNo ?? "", 100) || null,
        description: clampString(input.description ?? "", 500) || null,
        notes: clampString(input.notes ?? "", 1000) || null,
        department_id: optionalUuid(input.departmentId),
        net_amount: net,
        vat_rate: vatRate,
        vat_amount: vatAmount,
        post: Boolean(input.post),
      },
    });

    if (error) return { success: false, error: mapRpcError(error.message) };
    const result = (data || {}) as Record<string, unknown>;
    return {
      success: true,
      data: {
        id: String(result.id || ""),
        code: String(result.code || ""),
        status: String(result.status || "draft") as ExpenseStatus,
      },
    };
  } catch (err) {
    return actionError(err, "Xərc yadda saxlanmadı");
  }
}

export async function postExpenseAction(expenseId: string): Promise<ActionResult> {
  try {
    await requireAnyExpensePermission("can_manage_expenses");
    if (!isValidUuid(expenseId)) return { success: false, error: "Xərc sənədi tapılmadı" };
    const client = await createSupabaseServerClient();
    const { error } = await client.rpc("post_expense_atomic", { p_expense_id: expenseId });
    if (error) return { success: false, error: mapRpcError(error.message) };
    return { success: true };
  } catch (err) {
    return actionError(err, "Xərc təsdiqlənmədi");
  }
}

export async function cancelExpenseAction(expenseId: string, reason?: string): Promise<ActionResult> {
  try {
    await requireAnyExpensePermission("can_manage_expenses");
    if (!isValidUuid(expenseId)) return { success: false, error: "Xərc sənədi tapılmadı" };
    const client = await createSupabaseServerClient();
    const { error } = await client.rpc("cancel_expense_atomic", {
      p_expense_id: expenseId,
      p_reason: clampString(reason ?? "", 300) || undefined,
    });
    if (error) return { success: false, error: mapRpcError(error.message) };
    return { success: true };
  } catch (err) {
    return actionError(err, "Xərc ləğv edilmədi");
  }
}
