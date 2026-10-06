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
  EXPENSE_ATTACHMENT_TYPES,
  EXPENSE_STATUSES,
  isExpenseAttachmentPath,
  normalizeAttachmentMime,
  summarizeExpenses,
  validateExpenseAttachment,
  type ExpenseAttachment,
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
  is_vat_account: boolean;
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
  employees: ExpenseNamedOption[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS = 2000;
const ATTACHMENT_BUCKET = "expense-attachments";

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

/** Attachments per expense; empty when the attachments table is not there yet. */
async function countExpenseAttachments(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  expenseIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (let i = 0; i < expenseIds.length; i += 200) {
    const chunk = expenseIds.slice(i, i + 200);
    const { data, error } = await admin
      .from("expense_attachments" as never)
      .select("expense_id")
      .in("expense_id", chunk);
    if (error) return counts;
    for (const row of (data || []) as Array<{ expense_id: string }>) {
      counts.set(row.expense_id, (counts.get(row.expense_id) || 0) + 1);
    }
  }
  return counts;
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

    const [accountsRes, categoriesRes, suppliersRes, departmentsRes, employeesRes] = await Promise.all([
      admin.from("accounts").select("id,name,balance,is_vat_account").order("name"),
      fetchFinancialCategoryRows(admin, { includeInactive: false }),
      admin.from("suppliers").select("id,code,full_name,company_name").order("full_name").limit(1000),
      admin
        .from("employee_departments" as never)
        .select("id,name,is_active,sort_order")
        .order("sort_order"),
      admin.from("employees").select("id,full_name,status").order("full_name").limit(1000),
    ]);

    if (accountsRes.error) return { success: false, error: accountsRes.error.message };
    if (categoriesRes.error) return { success: false, error: categoriesRes.error };

    const access = resolveEffectiveAccess(profile);
    const accounts = filterAccountsByScope(
      ((accountsRes.data || []) as unknown as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id),
        name: String(row.name || ""),
        balance: toNumber(row.balance),
        is_vat_account: row.is_vat_account === true,
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

    const employees = ((employeesRes.data || []) as Array<Record<string, unknown>>)
      .filter((row) => String(row.status || "active") !== "terminated")
      .map((row) => ({ id: String(row.id), name: String(row.full_name || "").trim() }))
      .filter((row) => row.name);

    return {
      success: true,
      data: {
        accounts,
        categories: flattenExpenseCategoryOptions(categoriesRes.rows),
        suppliers,
        departments,
        employees,
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
          "cancel_reason,created_at,transaction_id,payment_mode,employee_id,rejected_reason,vat_account_id"
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
    const accountIds = Array.from(new Set([...ids("account_id"), ...ids("vat_account_id")]));
    const supplierIds = ids("supplier_id");
    const departmentIds = ids("department_id");
    const employeeIds = ids("employee_id");

    const [accountsRes, suppliersRes, departmentsRes, employeesRes] = await Promise.all([
      accountIds.length
        ? admin.from("accounts").select("id,name").in("id", accountIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      supplierIds.length
        ? admin.from("suppliers").select("id,code,full_name,company_name").in("id", supplierIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      departmentIds.length
        ? admin.from("employee_departments" as never).select("id,name").in("id", departmentIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      employeeIds.length
        ? admin.from("employees").select("id,full_name").in("id", employeeIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    ]);

    const attachmentCounts = await countExpenseAttachments(
      admin,
      rows.map((row) => String(row.id))
    );

    const nameMap = (list: unknown, label: (row: Record<string, unknown>) => string) =>
      new Map(((list || []) as Array<Record<string, unknown>>).map((row) => [String(row.id), label(row)]));
    const accountNames = nameMap(accountsRes.data, (row) => String(row.name || ""));
    const supplierNames = nameMap(suppliersRes.data, supplierLabel);
    const departmentNames = nameMap(departmentsRes.data, (row) => String(row.name || ""));
    const employeeNames = nameMap(employeesRes.data, (row) => String(row.full_name || ""));

    let mapped: ExpenseDocument[] = rows.map((row) => {
      const amount = toNumber(row.amount);
      const vat = toNumber(row.vat_amount);
      return {
        id: String(row.id),
        code: String(row.code || ""),
        expense_date: String(row.expense_date || "").slice(0, 10),
        status: (String(row.status || "posted") as ExpenseStatus),
        payment_mode: row.payment_mode === "employee" ? "employee" : "company",
        employee_id: (row.employee_id as string) || null,
        employee_name: row.employee_id ? employeeNames.get(String(row.employee_id)) || null : null,
        rejected_reason: (row.rejected_reason as string) || null,
        category_id: (row.category_id as string) || null,
        category: String(row.category || ""),
        account_id: (row.account_id as string) || null,
        account_name: row.account_id ? accountNames.get(String(row.account_id)) || null : null,
        vat_account_id: (row.vat_account_id as string) || null,
        vat_account_name: row.vat_account_id
          ? accountNames.get(String(row.vat_account_id)) || null
          : null,
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
        // Posted by this module means it has its own cash row; anything else
        // (production expenses) is cancelled where it was written.
        is_production: String(row.status || "posted") === "posted" && !row.transaction_id,
        attachment_count: attachmentCounts.get(String(row.id)) || 0,
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
          row.employee_name,
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
    const paymentMode = input.paymentMode === "employee" ? "employee" : "company";
    if (paymentMode === "employee" && !isValidUuid(input.employeeId ?? "")) {
      return { success: false, error: "Xərci ödəyən işçini seçin" };
    }
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
        vat_account_id:
          paymentMode === "company" && Number(input.vatAmount ?? 0) > 0
            ? optionalUuid(input.vatAccountId)
            : null,
        supplier_id: optionalUuid(input.supplierId),
        payee: clampString(input.payee ?? "", 200) || null,
        reference_no: clampString(input.referenceNo ?? "", 100) || null,
        description: clampString(input.description ?? "", 500) || null,
        notes: clampString(input.notes ?? "", 1000) || null,
        department_id: optionalUuid(input.departmentId),
        payment_mode: paymentMode,
        employee_id: paymentMode === "employee" ? optionalUuid(input.employeeId) : null,
        net_amount: net,
        vat_rate: vatRate,
        vat_amount: vatAmount,
        post: paymentMode === "company" && Boolean(input.post),
        submit: Boolean(input.submit),
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

async function runExpenseRpc(
  permission: PermissionKey,
  call: (client: Awaited<ReturnType<typeof createSupabaseServerClient>>) => PromiseLike<{
    error: { message: string } | null;
  }>,
  fallback: string
): Promise<ActionResult> {
  try {
    await requireAnyExpensePermission(permission);
    const client = await createSupabaseServerClient();
    const { error } = await call(client);
    if (error) return { success: false, error: mapRpcError(error.message) };
    return { success: true };
  } catch (err) {
    return actionError(err, fallback);
  }
}

export async function submitExpenseAction(expenseId: string): Promise<ActionResult> {
  if (!isValidUuid(expenseId)) return { success: false, error: "Xərc sənədi tapılmadı" };
  return runExpenseRpc(
    "can_manage_expenses",
    (client) => client.rpc("submit_expense_atomic", { p_expense_id: expenseId }),
    "Xərc təsdiqə göndərilmədi"
  );
}

export async function approveExpenseAction(expenseId: string): Promise<ActionResult> {
  if (!isValidUuid(expenseId)) return { success: false, error: "Xərc sənədi tapılmadı" };
  return runExpenseRpc(
    "can_manage_finance",
    (client) => client.rpc("approve_expense_atomic", { p_expense_id: expenseId }),
    "Xərc təsdiqlənmədi"
  );
}

export async function rejectExpenseAction(expenseId: string, reason?: string): Promise<ActionResult> {
  if (!isValidUuid(expenseId)) return { success: false, error: "Xərc sənədi tapılmadı" };
  return runExpenseRpc(
    "can_manage_finance",
    (client) =>
      client.rpc("reject_expense_atomic", {
        p_expense_id: expenseId,
        p_reason: clampString(reason ?? "", 300) || undefined,
      }),
    "Xərc geri qaytarılmadı"
  );
}

export async function reimburseExpenseAction(
  expenseId: string,
  accountId: string,
  payDate: string
): Promise<ActionResult> {
  if (!isValidUuid(expenseId)) return { success: false, error: "Xərc sənədi tapılmadı" };
  if (!isValidUuid(accountId)) return { success: false, error: "Kassa/bank hesabı seçilməlidir" };
  if (!ISO_DATE.test(payDate)) return { success: false, error: "Ödəniş tarixi düzgün deyil" };
  return runExpenseRpc(
    "can_manage_finance",
    (client) =>
      client.rpc("reimburse_expense_atomic", {
        p_expense_id: expenseId,
        p_account_id: accountId,
        p_pay_date: payDate,
      }),
    "Kompensasiya ödənilmədi"
  );
}

/* ------------------------------------------------------------------ */
/* Attachments: receipts and invoices in the private expense bucket.    */
/* Files go browser -> storage through a one-time signed upload URL, so */
/* they never pass through the server action body size limit.           */
/* ------------------------------------------------------------------ */

async function loadExpenseStatus(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  expenseId: string
): Promise<ExpenseStatus | null> {
  const { data } = await admin.from("expenses").select("status").eq("id", expenseId).maybeSingle();
  return data ? (String((data as Record<string, unknown>).status || "posted") as ExpenseStatus) : null;
}

export async function listExpenseAttachmentsAction(
  expenseId: string
): Promise<ActionResult<ExpenseAttachment[]>> {
  try {
    await requireAnyExpensePermission("can_view_expenses", "can_manage_expenses");
    if (!isValidUuid(expenseId)) return { success: false, error: "Xərc sənədi tapılmadı" };
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("expense_attachments" as never)
      .select("id,storage_path,file_name,mime_type,size_bytes,created_at")
      .eq("expense_id", expenseId)
      .order("created_at");
    if (error) return { success: false, error: error.message };

    const rows = (data || []) as Array<Record<string, unknown>>;
    const paths = rows.map((row) => String(row.storage_path));
    const urls = new Map<string, string>();
    if (paths.length) {
      const signed = await admin.storage.from(ATTACHMENT_BUCKET).createSignedUrls(paths, 3600);
      for (const item of signed.data || []) {
        if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
      }
    }

    return {
      success: true,
      data: rows.map((row) => ({
        id: String(row.id),
        file_name: String(row.file_name || ""),
        mime_type: (row.mime_type as string) || null,
        size_bytes: toNumber(row.size_bytes),
        created_at: String(row.created_at || ""),
        url: urls.get(String(row.storage_path)) || null,
      })),
    };
  } catch (err) {
    return actionError(err, "Sənədlər yüklənmədi");
  }
}

export async function createExpenseAttachmentUploadAction(
  expenseId: string,
  file: { name: string; type: string; size: number }
): Promise<ActionResult<{ path: string; token: string }>> {
  try {
    await requireAnyExpensePermission("can_manage_expenses");
    if (!isValidUuid(expenseId)) return { success: false, error: "Xərc sənədi tapılmadı" };
    const invalid = validateExpenseAttachment(file);
    if (invalid) return { success: false, error: invalid };

    const admin = createSupabaseAdminClient();
    const status = await loadExpenseStatus(admin, expenseId);
    if (!status) return { success: false, error: "Xərc sənədi tapılmadı" };
    if (status === "cancelled") return { success: false, error: "Ləğv edilmiş xərcə fayl əlavə etmək olmaz" };

    const ext = EXPENSE_ATTACHMENT_TYPES[normalizeAttachmentMime(file.type)];
    const path = `${expenseId}/${crypto.randomUUID()}.${ext}`;
    const { data, error } = await admin.storage.from(ATTACHMENT_BUCKET).createSignedUploadUrl(path);
    if (error || !data) return { success: false, error: error?.message || "Yükləmə hazırlanmadı" };
    return { success: true, data: { path: data.path, token: data.token } };
  } catch (err) {
    return actionError(err, "Yükləmə hazırlanmadı");
  }
}

export async function confirmExpenseAttachmentAction(
  expenseId: string,
  path: string,
  fileName: string
): Promise<ActionResult<{ id: string }>> {
  try {
    const { user } = await requireAnyExpensePermission("can_manage_expenses");
    if (!isValidUuid(expenseId) || !isExpenseAttachmentPath(expenseId, path)) {
      return { success: false, error: "Fayl tapılmadı" };
    }
    const admin = createSupabaseAdminClient();
    const bucket = admin.storage.from(ATTACHMENT_BUCKET);
    const info = await bucket.info(path);
    if (info.error || !info.data) return { success: false, error: "Fayl yüklənməyib" };

    const size = Number(info.data.size ?? 0);
    const mime = normalizeAttachmentMime(String(info.data.contentType || ""));
    const invalid = validateExpenseAttachment({ type: mime, size });
    if (invalid) {
      await bucket.remove([path]);
      return { success: false, error: invalid };
    }

    const { data, error } = await admin
      .from("expense_attachments" as never)
      .insert({
        expense_id: expenseId,
        storage_path: path,
        file_name: clampString(fileName || path.split("/").pop() || "fayl", 200),
        mime_type: mime,
        size_bytes: size,
        created_by: user.id,
      } as never)
      .select("id")
      .single();
    if (error || !data) {
      await bucket.remove([path]);
      return { success: false, error: error?.message || "Fayl yadda saxlanmadı" };
    }
    return { success: true, data: { id: String((data as Record<string, unknown>).id) } };
  } catch (err) {
    return actionError(err, "Fayl yadda saxlanmadı");
  }
}

export async function deleteExpenseAttachmentAction(attachmentId: string): Promise<ActionResult> {
  try {
    const { profile } = await requireAnyExpensePermission("can_manage_expenses");
    if (!isValidUuid(attachmentId)) return { success: false, error: "Fayl tapılmadı" };
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("expense_attachments" as never)
      .select("id,expense_id,storage_path")
      .eq("id", attachmentId)
      .maybeSingle();
    if (error) return { success: false, error: error.message };
    if (!data) return { success: false, error: "Fayl tapılmadı" };
    const row = data as Record<string, unknown>;

    // Receipts of a booked document are audit evidence: only finance removes them.
    const status = await loadExpenseStatus(admin, String(row.expense_id));
    const open = status === "draft" || status === "submitted";
    if (!open && !userHasPermission(profile, "can_manage_finance")) {
      return { success: false, error: "Təsdiqlənmiş xərcin sənədini yalnız maliyyə silə bilər" };
    }

    const removed = await admin.storage.from(ATTACHMENT_BUCKET).remove([String(row.storage_path)]);
    if (removed.error) return { success: false, error: removed.error.message };
    const { error: deleteError } = await admin
      .from("expense_attachments" as never)
      .delete()
      .eq("id", attachmentId);
    if (deleteError) return { success: false, error: deleteError.message };
    return { success: true };
  } catch (err) {
    return actionError(err, "Fayl silinmədi");
  }
}
