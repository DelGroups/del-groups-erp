export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/** Strict table row — required keys so Supabase `GenericTable` accepts the schema. */
type DbRow<T> = {
  [K in keyof T]-?: T[K] extends infer U | undefined ? U : T[K];
};

/** Form line item (UI) — persisted in sale_items table */
export interface SaleItem {
  id: string;
  product_id: string;
  product_code: string;
  product_name: string;
  warehouse_id: string;
  warehouse_name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  discount_percent: number;
  vat_rate: number;
  available_stock?: number;
  total: number;
  extra_info: string;
  /** Polywood: sell by linear meters or full sheets */
  polywood_sale_mode?: "linear_m" | "full_sheet" | null;
  polywood_full_sheet_length_m?: number;
  polywood_total_length_m?: number;
  polywood_full_sheet_count?: number;
}

/** Payment row stored in sales.payments JSONB */
export interface SalePayment {
  id: string;
  account_id: string;
  method: string;
  amount: number;
}

export interface SaleTotals {
  subtotal: number;
  discount_total: number;
  vat_total: number;
  delivery_cost: number;
  grand_total: number;
  paid_amount: number;
  remaining_balance: number;
}

export function calcLineTotal(
  quantity: number,
  unitPrice: number,
  discountPercent: number
): number {
  const qty = Number(quantity) || 0;
  const price = Number(unitPrice) || 0;
  const disc = Number(discountPercent) || 0;
  return qty * price - (qty * price * disc) / 100;
}

export function calcSubtotal(items: SaleItem[]): number {
  return items.reduce(
    (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0),
    0
  );
}

export function calcDiscountTotal(items: SaleItem[]): number {
  return items.reduce(
    (sum, item) =>
      sum +
      (Number(item.quantity) || 0) *
        (Number(item.unit_price) || 0) *
        ((Number(item.discount_percent) || 0) / 100),
    0
  );
}

export function calcVatTotal(items: SaleItem[]): number {
  return items.reduce((sum, item) => {
    const lineNet = calcLineTotal(item.quantity, item.unit_price, item.discount_percent);
    return sum + lineNet * ((Number(item.vat_rate) || 0) / 100);
  }, 0);
}

export function calcDeliveryCost(
  deliveryType: "paid" | "free",
  deliveryFee: number
): number {
  return deliveryType === "paid" ? Number(deliveryFee) || 0 : 0;
}

export function calcGrandTotal(
  subtotal: number,
  discountTotal: number,
  deliveryCost: number
): number {
  return subtotal - discountTotal + deliveryCost;
}

export function calcTotalPaid(payments: SalePayment[]): number {
  return payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
}

export function calcRemainingBalance(grandTotal: number, paidAmount: number): number {
  return grandTotal - paidAmount;
}

export function calcSaleTotals(
  items: SaleItem[],
  payments: SalePayment[],
  deliveryType: "paid" | "free",
  deliveryFee: number
): SaleTotals {
  const subtotal = calcSubtotal(items);
  const discount_total = calcDiscountTotal(items);
  const vat_total = calcVatTotal(items);
  const delivery_cost = calcDeliveryCost(deliveryType, deliveryFee);
  const grand_total = calcGrandTotal(subtotal, discount_total, delivery_cost);
  const paid_amount = calcTotalPaid(payments);
  const remaining_balance = calcRemainingBalance(grand_total, paid_amount);

  return {
    subtotal,
    discount_total,
    vat_total,
    delivery_cost,
    grand_total,
    paid_amount,
    remaining_balance,
  };
}

export function createEmptySaleItem(
  warehouseId = "",
  warehouseName = ""
): SaleItem {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    product_id: "",
    product_code: "",
    product_name: "",
    warehouse_id: warehouseId,
    warehouse_name: warehouseName,
    quantity: 1,
    unit: "Ədəd",
    unit_price: 0,
    discount_percent: 0,
    vat_rate: 0,
    available_stock: 0,
    total: 0,
    extra_info: "",
  };
}

export function toSaleItemsJson(items: SaleItem[]): Json {
  return items.map((item) => ({
    id: item.id,
    product_id: item.product_id,
    product_code: item.product_code,
    product_name: item.product_name,
    warehouse_id: item.warehouse_id,
    warehouse_name: item.warehouse_name,
    quantity: item.quantity,
    unit: item.unit,
    unit_price: item.unit_price,
    discount_percent: item.discount_percent,
    vat_rate: item.vat_rate,
    available_stock: item.available_stock ?? 0,
    total: item.total,
    extra_info: item.extra_info,
  }));
}

export function toSalePaymentsJson(payments: SalePayment[]): Json {
  return payments.map((p) => ({
    id: p.id,
    account_id: p.account_id,
    method: p.method,
    amount: p.amount,
  }));
}

// ─── Products & Inventory ───────────────────────────────────────────────────

export interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  created_at?: string | null;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  location?: string | null;
  is_default?: boolean | null;
  warehouse_type?: "general" | "polywood" | string | null;
  created_at?: string | null;
}

export interface Product {
  id: string;
  code: string;
  name: string;
  category: string;
  subcategory?: string | null;
  unit: string;
  buy_price: number;
  sell_price: number;
  stock: number;
  min_stock?: number | null;
  barcode?: string | null;
  color?: string | null;
  weight?: number | null;
  extra_info?: string | null;
  warehouse_id?: string | null;
  inventory_mode?: "standard" | "polywood" | string | null;
  full_sheet_length_m?: number | null;
  created_at?: string | null;
}

export type ProductInsert = Omit<Product, "id" | "created_at"> & {
  id?: string;
  created_at?: string | null;
};

export type ProductColumnKey =
  | "name"
  | "code"
  | "category"
  | "subcategory"
  | "buy_price"
  | "sell_price"
  | "barcode"
  | "unit"
  | "color"
  | "weight"
  | "extra_info";

export interface ProductFilters {
  name: string;
  code: string;
  category: string;
  subcategory: string;
  warehouseId: string;
  barcode: string;
}

export const DEFAULT_PRODUCT_FILTERS: ProductFilters = {
  name: "",
  code: "",
  category: "",
  subcategory: "",
  warehouseId: "",
  barcode: "",
};

export interface DamagedGoodsItem {
  id: string;
  product_id: string;
  product_code: string;
  product_name: string;
  quantity: number;
  unit: string;
  issue_description: string;
  available_stock: number;
}

export interface InventoryWriteoff {
  id: string;
  document_number: string;
  warehouse_id: string | null;
  checker_name: string;
  writeoff_date: string;
  items: DamagedGoodsItem[];
  notes: string | null;
  created_at: string | null;
}

export type InventoryWriteoffInsert = {
  document_number: string;
  warehouse_id?: string | null;
  checker_name: string;
  writeoff_date: string;
  items: Json;
  notes?: string | null;
};

export function createEmptyDamagedGoodsItem(): DamagedGoodsItem {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    product_id: "",
    product_code: "",
    product_name: "",
    quantity: 1,
    unit: "Ədəd",
    issue_description: "",
    available_stock: 0,
  };
}

export function toDamagedGoodsItemsJson(items: DamagedGoodsItem[]): Json {
  return items.map((item) => ({
    id: item.id,
    product_id: item.product_id,
    product_code: item.product_code,
    product_name: item.product_name,
    quantity: item.quantity,
    unit: item.unit,
    issue_description: item.issue_description,
    available_stock: item.available_stock,
  }));
}

export function generateWriteoffDocumentNumber(): string {
  const year = new Date().getFullYear();
  const seq = Math.floor(10000 + Math.random() * 90000);
  return `DG-${year}-${seq}`;
}

/** @deprecated use generateWriteoffDocumentNumber */
export const generateWriteoffDocNo = generateWriteoffDocumentNumber;

// ─── Warehouse slips ─────────────────────────────────────────────────────────

export type WarehouseSlipType = "inbound" | "outbound" | "waste";
export type WarehouseSlipStatus = "pending" | "approved" | "rejected";
export type WarehouseSlipSourceType = "purchase" | "sale" | "writeoff";

export interface WarehouseSlipItem {
  product_id: string;
  product_code: string;
  product_name: string;
  quantity: number;
  unit: string;
  unit_price?: number;
  issue_description?: string;
}

export interface WarehouseSlip {
  id: string;
  slip_number: string;
  type: WarehouseSlipType;
  status: WarehouseSlipStatus;
  source_document_id: string | null;
  source_document_no: string | null;
  source_type: WarehouseSlipSourceType | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
  items: WarehouseSlipItem[];
  notes: string | null;
  created_by: string | null;
  approved_by: string | null;
  created_at: string | null;
  approved_at: string | null;
  delivery_due_at: string | null;
}

export type WarehouseSlipInsert = {
  slip_number: string;
  type: WarehouseSlipType;
  status?: WarehouseSlipStatus;
  source_document_id?: string | null;
  source_document_no?: string | null;
  source_type?: WarehouseSlipSourceType | null;
  warehouse_id?: string | null;
  warehouse_name?: string | null;
  items: Json;
  notes?: string | null;
  created_by?: string | null;
  approved_by?: string | null;
  created_at?: string | null;
  approved_at?: string | null;
  delivery_due_at?: string | null;
};

export function toWarehouseSlipItemsJson(items: WarehouseSlipItem[]): Json {
  return items.map((item) => ({
    product_id: item.product_id,
    product_code: item.product_code,
    product_name: item.product_name,
    quantity: item.quantity,
    unit: item.unit,
    unit_price: item.unit_price ?? null,
    issue_description: item.issue_description ?? null,
  }));
}

export function generateProductCode(): string {
  return `PRD-${Math.floor(1000 + Math.random() * 9000)}`;
}

// ─── Sales (normalized sale_items) ──────────────────────────────────────────

export interface SaleItemRow {
  id?: string;
  sale_id?: string;
  product_id: string | null;
  product_code: string | null;
  product_name: string | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
  quantity: number;
  unit: string | null;
  unit_price: number;
  discount_percent: number;
  vat_rate: number;
  line_total: number;
  extra_info: string | null;
  polywood_sale_mode?: string | null;
  polywood_length_m?: number | null;
  polywood_cut_details?: Json | null;
  created_at?: string | null;
}

export type SaleItemInsert = Omit<SaleItemRow, "id" | "created_at"> & {
  id?: string;
  sale_id: string;
};

export interface Customer {
  id: string;
  code?: string | null;
  full_name?: string | null;
  name?: string | null;
  phone?: string | null;
  company_name?: string | null;
  address?: string | null;
  voen?: string | null;
  balance?: number | null;
  created_at?: string | null;
}

export interface CompanySettings {
  id: string;
  company_name: string | null;
  voen: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  bank_name: string | null;
  iban: string | null;
  vat_rate: number | null;
  currency: string | null;
  created_at?: string | null;
}

export interface ExpenseRow {
  id: string;
  code: string | null;
  category: string | null;
  amount: number | null;
  account_id: string | null;
  notes: string | null;
  created_at: string | null;
}

export interface CommissionRule {
  id: string;
  category_name: string;
  min_sales: number;
  max_sales: number | null;
  commission_percentage: number;
  created_at?: string | null;
}

export type CommissionRuleInsert = Omit<CommissionRule, "id" | "created_at"> & {
  id?: string;
  created_at?: string | null;
};

/** Empty "Maks. Satış" means no upper limit → store null in Supabase. */
export function parseNullableMaxSales(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const num = parseFloat(trimmed);
  return Number.isFinite(num) ? num : null;
}

export function normalizeCommissionRule(row: Record<string, unknown>): CommissionRule {
  return {
    id: row.id as string,
    category_name: (row.category_name as string) || "",
    min_sales: Number(row.min_sales) || 0,
    max_sales:
      row.max_sales === null || row.max_sales === undefined
        ? null
        : Number(row.max_sales),
    commission_percentage:
      Number(row.commission_percentage ?? row.commission_rate) || 0,
    created_at: (row.created_at as string) || null,
  };
}

export interface ConsignmentOrder {
  id: string;
  customer_name: string;
  seller_name?: string | null;
  product_name: string;
  category_name?: string | null;
  sent_qty: number;
  sold_qty: number;
  returned_qty: number;
  remaining_qty: number;
  unit_price: number;
  created_at?: string | null;
}

export type ConsignmentOrderInsert = Omit<ConsignmentOrder, "id" | "created_at"> & {
  id?: string;
};

export function saleLineItemsToRows(saleId: string, items: SaleItem[]): SaleItemInsert[] {
  return items.map((item) => ({
    sale_id: saleId,
    product_id: item.product_id || null,
    product_code: item.product_code || null,
    product_name: item.product_name || null,
    warehouse_id: item.warehouse_id || null,
    warehouse_name: item.warehouse_name || null,
    quantity: item.quantity,
    unit: item.unit || "Ədəd",
    unit_price: item.unit_price,
    discount_percent: item.discount_percent,
    vat_rate: item.vat_rate,
    line_total: item.total,
    extra_info: item.extra_info || null,
    polywood_sale_mode: item.polywood_sale_mode || null,
    polywood_length_m:
      item.polywood_sale_mode === "linear_m"
        ? item.quantity
        : item.polywood_sale_mode === "full_sheet"
          ? (item.polywood_full_sheet_length_m || 4) * item.quantity
          : null,
  }));
}

// ─── Purchases ──────────────────────────────────────────────────────────────

export interface Supplier {
  id: string;
  code?: string | null;
  full_name?: string | null;
  company_name?: string | null;
  phone?: string | null;
  balance?: number | null;
  created_at?: string | null;
}

export interface PurchaseLineItem {
  id: string;
  product_id: string;
  product_code: string;
  product_name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total: number;
}

export interface PurchaseItemRow {
  id?: string;
  purchase_id?: string;
  product_id: string | null;
  product_code?: string | null;
  product_name?: string | null;
  quantity: number;
  unit?: string | null;
  unit_price: number;
  total_price: number;
}

export type PurchaseItemInsert = Omit<PurchaseItemRow, "id"> & {
  id?: string;
  purchase_id: string;
};

export interface Purchase {
  id: string;
  invoice_number: string;
  supplier_id: string | null;
  warehouse_id?: string | null;
  doc_date?: string | null;
  responsible_id?: string | null;
  responsible_name?: string | null;
  total_amount: number;
  paid_amount: number;
  debt_amount: number;
  status: string | null;
  notes?: string | null;
  created_at: string | null;
  warehouse_sent?: boolean;
  warehouse_slip_status?: WarehouseSlipStatus | null;
}

export type PurchaseInsert = {
  invoice_number: string;
  supplier_id: string;
  warehouse_id?: string | null;
  doc_date?: string | null;
  responsible_id?: string | null;
  responsible_name?: string | null;
  total_amount: number;
  paid_amount: number;
  debt_amount: number;
  status?: string | null;
  notes?: string | null;
};

export interface PurchaseRecord extends Purchase {
  supplier_name?: string;
  supplier_company?: string;
  warehouse_name?: string;
  items: PurchaseLineItem[];
}

/** Payment row captured on purchase form submit */
export interface PurchasePaymentRow {
  id: string;
  account_id: string;
  amount: number;
  payment_date: string;
  note: string;
}

// ─── Access control (roles, profiles, permissions) ───────────────────────────

export const PERMISSION_MODULES = [
  {
    id: "dashboard",
    title: "Əsas Panel",
    permissions: [{ key: "can_view_dashboard", label: "Ana səhifəni görmək" }],
  },
  {
    id: "sales",
    title: "Satış",
    permissions: [
      { key: "can_view_sales", label: "Satışları görmək" },
      { key: "can_create_invoice", label: "Satış fakturası yaratmaq" },
      { key: "can_edit_sales", label: "Satışları redaktə etmək" },
      { key: "can_delete_sales", label: "Satışları silmək" },
    ],
  },
  {
    id: "purchases",
    title: "Alış",
    permissions: [
      { key: "can_view_purchases", label: "Alışları görmək" },
      { key: "can_create_purchase", label: "Alış fakturası yaratmaq" },
      { key: "can_edit_purchases", label: "Alışları redaktə etmək" },
      { key: "can_delete_purchases", label: "Alışları silmək" },
    ],
  },
  {
    id: "consignments",
    title: "Əmanət Satışı",
    permissions: [
      { key: "can_view_consignments", label: "Əmanət sənədlərini görmək" },
      { key: "can_manage_consignments", label: "Əmanət sənədlərini idarə etmək" },
    ],
  },
  {
    id: "inventory",
    title: "Anbar və Məhsul",
    permissions: [
      { key: "can_view_products", label: "Məhsulları görmək" },
      { key: "can_manage_products", label: "Məhsulları idarə etmək" },
      { key: "can_manage_warehouses", label: "Anbarları idarə etmək" },
      { key: "can_writeoff_inventory", label: "Zədələnmə çıxışı etmək" },
      { key: "can_view_warehouse_slips", label: "Anbar qaimələrini görmək" },
      { key: "can_approve_warehouse_slips", label: "Anbar qaimələrini təsdiqləmək" },
      { key: "can_send_to_warehouse", label: "Fakturanı anbara göndərmək" },
    ],
  },
  {
    id: "production",
    title: "İstehsalat",
    permissions: [
      { key: "can_view_production", label: "İstehsalatı görmək" },
      { key: "can_manage_production", label: "İstehsalatı idarə etmək" },
    ],
  },
  {
    id: "crm",
    title: "Əlaqələr",
    permissions: [
      { key: "can_view_customers", label: "Müştəriləri görmək" },
      { key: "can_manage_customers", label: "Müştəriləri idarə etmək" },
      { key: "can_view_suppliers", label: "Təchizatçıları görmək" },
      { key: "can_manage_suppliers", label: "Təchizatçıları idarə etmək" },
    ],
  },
  {
    id: "finance",
    title: "Maliyyə",
    permissions: [
      { key: "can_view_finance", label: "Kassa və tranzaksiyaları görmək" },
      { key: "can_manage_finance", label: "Kassa və tranzaksiyaları idarə etmək" },
      { key: "can_view_expenses", label: "Xərcləri görmək" },
      { key: "can_manage_expenses", label: "Xərcləri idarə etmək" },
    ],
  },
  {
    id: "hr",
    title: "İnsan Resursları",
    permissions: [
      { key: "can_view_hr", label: "İşçiləri görmək" },
      { key: "can_manage_hr", label: "İşçiləri və maaşları idarə etmək" },
      { key: "can_view_commissions", label: "Komissiyaları görmək" },
      { key: "can_manage_commissions", label: "Komissiyaları idarə etmək" },
    ],
  },
  {
    id: "reports",
    title: "Hesabatlar",
    permissions: [
      { key: "can_view_reports", label: "Satış hesabatlarını görmək" },
      { key: "can_view_financial_reports", label: "Maliyyə hesabatlarını görmək" },
    ],
  },
  {
    id: "administration",
    title: "Administrasiya",
    permissions: [
      { key: "can_view_settings", label: "Tənzimləmələri görmək" },
      { key: "can_manage_settings", label: "Tənzimləmələri dəyişmək" },
      { key: "can_manage_users", label: "İstifadəçiləri idarə etmək" },
      { key: "can_manage_roles", label: "Rol və icazələri idarə etmək" },
    ],
  },
] as const;

export type PermissionKey =
  (typeof PERMISSION_MODULES)[number]["permissions"][number]["key"];

export type PermissionMap = Partial<Record<PermissionKey, boolean>>;

/** Role name that bypasses the "own documents only" constraint. */
export const ADMIN_ROLE_NAME = "Admin";

export interface Role {
  id: string;
  name: string;
  description: string | null;
  permissions: PermissionMap;
  is_system: boolean;
  created_at: string;
}

export type RoleInsert = {
  name: string;
  description?: string | null;
  permissions: PermissionMap;
  is_system?: boolean;
  created_at?: string;
};

/** Supabase `roles` table row (permissions stored as JSONB). */
export type RoleDbRow = {
  id: string;
  name: string;
  description: string | null;
  permissions: Json;
  is_system: boolean;
  created_at: string;
};

export type RoleDbInsert = {
  id?: string;
  name: string;
  description?: string | null;
  permissions?: Json;
  is_system?: boolean;
  created_at?: string;
};

export type RoleDbUpdate = Partial<RoleDbInsert>;

export interface ProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
  role_id: string | null;
  employee_id: string | null;
  is_active: boolean | null;
  locale?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export type ProfileInsert = {
  id: string;
  email?: string | null;
  full_name?: string | null;
  role_id?: string | null;
  employee_id?: string | null;
  is_active?: boolean | null;
  locale?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ProfileUpdate = Partial<Omit<ProfileInsert, "id">>;

/** A profile joined with its role — what the UI works with. */
export interface UserProfile extends Omit<ProfileRow, "is_active"> {
  is_active: boolean;
  role: Role | null;
}

export function allPermissionKeys(): PermissionKey[] {
  return PERMISSION_MODULES.flatMap((mod) =>
    mod.permissions.map((perm) => perm.key as PermissionKey)
  );
}

export function createPermissionMap(value: boolean): PermissionMap {
  const map: PermissionMap = {};
  for (const key of allPermissionKeys()) map[key] = value;
  return map;
}

export function normalizePermissions(raw: unknown): PermissionMap {
  const source = (raw ?? {}) as Record<string, unknown>;
  const map: PermissionMap = {};
  for (const key of allPermissionKeys()) map[key] = source[key] === true;
  return map;
}

export function normalizeRole(row: Record<string, unknown>): Role {
  return {
    id: row.id as string,
    name: (row.name as string) || "",
    description: (row.description as string) ?? null,
    permissions: normalizePermissions(row.permissions),
    is_system: row.is_system === true,
    created_at: typeof row.created_at === "string" ? row.created_at : "",
  };
}

export function hasPermission(
  permissions: PermissionMap | null | undefined,
  key: PermissionKey
): boolean {
  return permissions?.[key] === true;
}

export function isAdminRole(role: Role | null | undefined): boolean {
  return role?.name === ADMIN_ROLE_NAME;
}

export interface Database {
  public: {
    Tables: {
      sales: {
        Row: {
          id: string;
          doc_no: string | null;
          doc_date: string | null;
          customer_id: string | null;
          customer_name: string | null;
          seller_id: string | null;
          seller_name: string | null;
          warehouse_name: string | null;
          subtotal: number | null;
          discount_total: number | null;
          vat_total: number | null;
          total_amount: number | null;
          paid_amount: number | null;
          remaining_balance: number | null;
          delivery_address: string | null;
          delivery_type: string | null;
          delivery_fee: number | null;
          note: string | null;
          notes: string | null;
          payments: Json | null;
          invoice_number: string | null;
          created_at: string | null;
          warehouse_sent: boolean | null;
          warehouse_slip_status: string | null;
        };
        Insert: {
          id?: string;
          doc_no?: string | null;
          doc_date?: string | null;
          customer_id?: string | null;
          customer_name?: string | null;
          seller_id?: string | null;
          seller_name?: string | null;
          warehouse_name?: string | null;
          subtotal?: number | null;
          discount_total?: number | null;
          vat_total?: number | null;
          total_amount?: number | null;
          paid_amount?: number | null;
          remaining_balance?: number | null;
          delivery_address?: string | null;
          delivery_type?: string | null;
          delivery_fee?: number | null;
          note?: string | null;
          notes?: string | null;
          payments?: Json | null;
          invoice_number?: string | null;
          created_at?: string | null;
          warehouse_sent?: boolean | null;
          warehouse_slip_status?: string | null;
        };
        Update: {
          id?: string;
          doc_no?: string | null;
          doc_date?: string | null;
          customer_id?: string | null;
          customer_name?: string | null;
          seller_id?: string | null;
          seller_name?: string | null;
          warehouse_name?: string | null;
          subtotal?: number | null;
          discount_total?: number | null;
          vat_total?: number | null;
          total_amount?: number | null;
          paid_amount?: number | null;
          remaining_balance?: number | null;
          delivery_address?: string | null;
          delivery_type?: string | null;
          delivery_fee?: number | null;
          note?: string | null;
          notes?: string | null;
          payments?: Json | null;
          invoice_number?: string | null;
          created_at?: string | null;
          warehouse_sent?: boolean | null;
          warehouse_slip_status?: string | null;
        };
        Relationships: [];
      };
      sale_items: {
        Row: DbRow<SaleItemRow & { id: string; sale_id: string }>;
        Insert: SaleItemInsert;
        Update: Partial<SaleItemInsert>;
        Relationships: [];
      };
      customers: {
        Row: DbRow<Customer>;
        Insert: Partial<Customer>;
        Update: Partial<Customer>;
        Relationships: [];
      };
      employees: {
        Row: DbRow<Employee>;
        Insert: EmployeeDbInsert & { id?: string; created_at?: string | null };
        Update: Partial<EmployeeDbInsert>;
        Relationships: [];
      };
      warehouses: {
        Row: DbRow<Warehouse>;
        Insert: Omit<Warehouse, "id" | "created_at"> & { id?: string; created_at?: string | null };
        Update: Partial<Warehouse>;
        Relationships: [];
      };
      accounts: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      products: {
        Row: DbRow<Product>;
        Insert: Partial<Product> & Pick<Product, "name">;
        Update: Partial<Product>;
        Relationships: [];
      };
      categories: {
        Row: DbRow<Category>;
        Insert: Omit<Category, "id" | "created_at"> & { id?: string; created_at?: string | null };
        Update: Partial<Category>;
        Relationships: [];
      };
      inventory_writeoffs: {
        Row: {
          id: string;
          document_number: string;
          warehouse_id: string | null;
          checker_name: string;
          writeoff_date: string | null;
          notes: string | null;
          items: Json | null;
          created_at: string | null;
        };
        Insert: InventoryWriteoffInsert & { id?: string; created_at?: string | null };
        Update: Partial<InventoryWriteoffInsert>;
        Relationships: [];
      };
      warehouse_slips: {
        Row: DbRow<WarehouseSlip>;
        Insert: WarehouseSlipInsert & { id?: string };
        Update: Partial<WarehouseSlipInsert>;
        Relationships: [];
      };
      commission_rules: {
        Row: DbRow<CommissionRule>;
        Insert: Omit<CommissionRule, "id" | "created_at"> & { id?: string; created_at?: string | null };
        Update: Partial<CommissionRule>;
        Relationships: [];
      };
      consignment_orders: {
        Row: DbRow<ConsignmentOrder>;
        Insert: ConsignmentOrderInsert;
        Update: Partial<ConsignmentOrderInsert>;
        Relationships: [];
      };
      consignment_partners: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      consignment_dispatches: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      consignment_inventory: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      consignment_monthly_reports: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      consignment_returns: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      purchases: {
        Row: DbRow<Purchase>;
        Insert: PurchaseInsert & { id?: string; created_at?: string | null };
        Update: Partial<Purchase>;
        Relationships: [
          {
            foreignKeyName: "purchases_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
        ];
      };
      purchase_items: {
        Row: DbRow<PurchaseItemRow & { id: string; purchase_id: string }>;
        Insert: PurchaseItemInsert;
        Update: Partial<PurchaseItemInsert>;
        Relationships: [];
      };
      suppliers: {
        Row: DbRow<Supplier>;
        Insert: Partial<Supplier>;
        Update: Partial<Supplier>;
        Relationships: [];
      };
      transactions: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      company_settings: {
        Row: DbRow<CompanySettings>;
        Insert: Partial<CompanySettings> & Pick<CompanySettings, "company_name">;
        Update: Partial<CompanySettings>;
        Relationships: [];
      };
      settings: {
        Row: {
          id: string;
          company_name: string | null;
          logo_url: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          company_name?: string | null;
          logo_url?: string | null;
          created_at?: string | null;
        };
        Update: {
          company_name?: string | null;
          logo_url?: string | null;
        };
        Relationships: [];
      };
      sales_commissions: {
        Row: DbRow<SalesCommission>;
        Insert: SalesCommissionInsert;
        Update: Partial<SalesCommissionInsert>;
        Relationships: [];
      };
      employee_commission_rules: {
        Row: DbRow<EmployeeCommissionRule>;
        Insert: EmployeeCommissionRuleInsert;
        Update: Partial<EmployeeCommissionRuleInsert>;
        Relationships: [];
      };
      salary_payments: {
        Row: DbRow<PayrollRecord>;
        Insert: Partial<PayrollRecord> & Pick<PayrollRecord, "employee_id" | "account_id">;
        Update: Partial<PayrollRecord>;
        Relationships: [];
      };
      expenses: {
        Row: DbRow<ExpenseRow>;
        Insert: Partial<ExpenseRow>;
        Update: Partial<ExpenseRow>;
        Relationships: [
          {
            foreignKeyName: "expenses_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      production_boms: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      production_bom_items: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      production_orders: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      production_materials: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      production_outsourcing: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      production_contractors: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      production_contracts: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      roles: {
        Row: RoleDbRow;
        Insert: RoleDbInsert;
        Update: RoleDbUpdate;
        Relationships: [];
      },
      profiles: {
        Row: DbRow<ProfileRow>;
        Insert: ProfileInsert;
        Update: ProfileUpdate;
        Relationships: [];
      },
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      create_expense_atomic: {
        Args: {
          p_code: string;
          p_category: string;
          p_amount: number;
          p_account_id: string;
          p_notes?: string | null;
        };
        Returns: string;
      };
      process_payroll_atomic: {
        Args: {
          p_employee_id: string;
          p_account_id: string;
          p_base_salary: number;
          p_deductions: number;
          p_month_year: string;
          p_notes?: string | null;
          p_commission_ids?: string[];
        };
        Returns: string;
      };
      post_sale: {
        Args: Record<string, unknown>;
        Returns: unknown;
      };
    };
  };
}

export type SaleInsert = Database["public"]["Tables"]["sales"]["Insert"];
export type PurchaseInsertType = Database["public"]["Tables"]["purchases"]["Insert"];

// ─── Dashboard & Reports ────────────────────────────────────────────────────

export type ReportDatePreset = "today" | "week" | "month" | "custom";

export interface ReportFilters {
  datePreset: ReportDatePreset;
  startDate: string;
  endDate: string;
  warehouseId: string;
  category: string;
  employeeId: string;
}

export interface DashboardKpis {
  monthlyRevenue: number;
  monthlyExpenses: number;
  netProfit: number;
  customerDebts: number;
  supplierDebts: number;
}

export interface LowStockProduct {
  id: string;
  code: string;
  name: string;
  stock: number;
  min_stock: number;
  unit: string;
  category: string;
}

export interface RecentActivityRow {
  id: string;
  date: string;
  type: string;
  reference: string;
  party: string;
  amount: number;
  direction: "in" | "out";
}

export interface MonthlyTrendPoint {
  label: string;
  revenue: number;
  expenses: number;
}

export interface DashboardData {
  kpis: DashboardKpis;
  lowStockAlerts: LowStockProduct[];
  recentActivities: RecentActivityRow[];
  monthlyTrend: MonthlyTrendPoint[];
}

export interface TopSellingProduct {
  product_id: string;
  product_name: string;
  product_code: string;
  category: string;
  quantity: number;
  revenue: number;
  cost: number;
  profit: number;
  marginPercent: number;
}

export interface SalesReportSummary {
  totalVolume: number;
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  averageMargin: number;
  invoiceCount: number;
}

export interface SalesReportData {
  topProducts: TopSellingProduct[];
  summary: SalesReportSummary;
}

export interface FinanceLedgerRow {
  id: string;
  date: string;
  type: string;
  category: string;
  account_name: string;
  notes: string | null;
  amount: number;
  direction: "in" | "out";
}

export interface FinancialCategoryTotal {
  category: string;
  type: string;
  total: number;
}

export interface FinancialReportSummary {
  totalIncome: number;
  totalExpense: number;
  netFlow: number;
  byCategory: FinancialCategoryTotal[];
}

export interface FinancialReportData {
  ledger: FinanceLedgerRow[];
  summary: FinancialReportSummary;
}

export interface EmployeeOption {
  id: string;
  full_name: string;
}

// ─── HR & Payroll ───────────────────────────────────────────────────────────

export const EMPLOYEE_DEPARTMENTS = [
  { value: "furniture", label: "Mebel istehsalı" },
  { value: "design", label: "Interyer dizayn" },
  { value: "advertising", label: "Reklam" },
  { value: "stationery", label: "Dəftərxana satışı" },
  { value: "general", label: "Ümumi" },
] as const;

export type EmployeeDepartment = (typeof EMPLOYEE_DEPARTMENTS)[number]["value"];
export type EmployeeStatus = "active" | "inactive" | "on_leave";
export type CommissionStatus = "pending" | "paid";

export interface Employee {
  id: string;
  employee_code: string;
  full_name: string;
  role: string;
  department: string;
  phone: string | null;
  base_salary: number;
  default_commission: number;
  status: string;
  created_at?: string | null;
}

/** Exact column names sent to Supabase `employees` table. */
export type EmployeeDbInsert = {
  employee_code: string;
  full_name: string;
  role: string;
  department: string;
  phone: string | null;
  base_salary: number;
  default_commission: number;
  status: string;
};

export type EmployeeInsert = EmployeeDbInsert;

export function toEmployeeDbRow(payload: EmployeeInsert): EmployeeDbInsert {
  return {
    employee_code: payload.employee_code.trim() || generateEmployeeCode(),
    full_name: payload.full_name.trim(),
    role: payload.role.trim(),
    department: payload.department.trim() || "general",
    phone: payload.phone?.trim() || null,
    base_salary: Number(payload.base_salary) || 0,
    default_commission: Number(payload.default_commission) || 0,
    status: payload.status.trim() || "active",
  };
}

export interface EmployeeCommissionRule {
  id: string;
  employee_id: string;
  category_name: string;
  commission_rate: number;
  created_at?: string | null;
}

export type EmployeeCommissionRuleInsert = Omit<
  EmployeeCommissionRule,
  "id" | "created_at"
> & { id?: string };

export interface SalesCommission {
  id: string;
  sale_id: string;
  employee_id: string | null;
  seller_name: string | null;
  sale_doc_no: string | null;
  product_category: string;
  product_name: string | null;
  sale_amount: number;
  commission_rate: number;
  commission_amount: number;
  status: CommissionStatus;
  payroll_id: string | null;
  created_at: string | null;
}

export type SalesCommissionInsert = Omit<SalesCommission, "id" | "created_at"> & {
  id?: string;
};

export interface PayrollRecord {
  id: string;
  employee_id: string;
  account_id: string;
  month_year: string;
  base_salary: number;
  commission_total: number;
  deductions: number;
  net_amount: number;
  amount: number;
  status: "paid" | "draft";
  notes: string | null;
  created_at: string | null;
  employees?: { full_name: string } | null;
  accounts?: { name: string } | null;
}

export interface PendingCommissionSummary {
  employee_id: string;
  employee_name: string;
  department: string;
  pending_count: number;
  pending_total: number;
  commissions: SalesCommission[];
}

export interface ProcessPayrollPayload {
  employeeId: string;
  accountId: string;
  monthYear: string;
  baseSalary: number;
  commissionIds: string[];
  commissionTotal: number;
  deductions: number;
  notes: string;
}

export interface ProcessPayrollResult {
  success: boolean;
  error?: string;
  payrollId?: string;
}

export function getDepartmentLabel(dept: string): string {
  return EMPLOYEE_DEPARTMENTS.find((d) => d.value === dept)?.label ?? dept;
}

export function getEmployeeStatusLabel(status: string): string {
  switch (status) {
    case "active":
      return "Aktiv";
    case "inactive":
      return "Qeyri-aktiv";
    case "on_leave":
      return "Məzuniyyətdə";
    default:
      return status;
  }
}

export function generateEmployeeCode(): string {
  return `EMP-${Math.floor(100 + Math.random() * 900)}`;
}

export function normalizeEmployee(row: Record<string, unknown>): Employee {
  return {
    id: row.id as string,
    employee_code:
      (row.employee_code as string) ||
      (row.code as string) ||
      "",
    full_name: (row.full_name as string) || (row.name as string) || "",
    role: (row.role as string) || (row.position as string) || "",
    department: (row.department as string) || "general",
    phone: (row.phone as string) || null,
    base_salary: Number(row.base_salary ?? row.salary) || 0,
    default_commission:
      Number(row.default_commission ?? row.default_commission_rate) || 0,
    status: (row.status as string) || "active",
    created_at: (row.created_at as string) || null,
  };
}

export function calcPayrollNet(
  baseSalary: number,
  commissionTotal: number,
  deductions: number
): number {
  return Math.max(0, baseSalary + commissionTotal - deductions);
}
