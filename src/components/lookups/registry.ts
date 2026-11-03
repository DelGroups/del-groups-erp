/**
 * Every entity a lookup field can point to (UI-2 lookups): which table it reads, what it
 * searches, how one row reads in the list, and who may quick-create it. Pure data, no React
 * and no Supabase, so the permission rules are tested under plain Node (tests/lookups.test.mjs).
 *
 * Carriers, customs offices and brokers are suppliers: an import cost's "paid to" field is a
 * supplier lookup. CRM contacts and companies are customers (deals point to customers.id).
 */
import { joinHint, joinLabel } from "./logic";

export type LookupEntity =
  | "customer"
  | "supplier"
  | "partner"
  | "consignmentPartner"
  | "product"
  | "warehouse"
  | "account"
  | "employee"
  | "expenseCategory"
  | "productCategory";

export const LOOKUP_ENTITIES: readonly LookupEntity[] = [
  "customer",
  "supplier",
  "partner",
  "consignmentPartner",
  "product",
  "warehouse",
  "account",
  "employee",
  "expenseCategory",
  "productCategory",
];

/** A database row as the lookup reads it (select "*" or the listed columns). */
export type LookupRecord = { id: string } & Record<string, unknown>;

/** Equality filters always applied (e.g. only expense categories); false also matches NULL. */
export type LookupWhere = Readonly<Record<string, string | number | boolean | null>>;

export interface LookupEntityDef {
  entity: LookupEntity;
  table: string;
  select: string;
  /** Columns the typed text is matched against (ilike). */
  searchColumns: readonly string[];
  order: { column: string; ascending: boolean };
  /** Filters every search of this entity carries. */
  baseWhere?: LookupWhere;
  /** Any one of these lets the user quick-create (the same checks as the full pages / actions). */
  createPermissions: readonly string[];
  label: (row: LookupRecord) => string;
  hint: (row: LookupRecord) => string | undefined;
}

const text = (value: unknown): string => (value === null || value === undefined ? "" : String(value));

function partyLabel(row: LookupRecord): string {
  return joinLabel(text(row.full_name) || text(row.name), text(row.company_name));
}

function partyHint(row: LookupRecord): string | undefined {
  return joinHint([text(row.code), text(row.phone), row.voen ? `VÖEN ${text(row.voen)}` : ""]);
}

function stockText(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return String(Math.round(n * 1000) / 1000);
}

export const LOOKUP_REGISTRY: Readonly<Record<LookupEntity, LookupEntityDef>> = {
  customer: {
    entity: "customer",
    table: "customers",
    select: "*",
    searchColumns: ["full_name", "company_name", "code", "phone", "voen"],
    order: { column: "full_name", ascending: true },
    createPermissions: ["can_manage_customers"],
    label: partyLabel,
    hint: partyHint,
  },
  supplier: {
    entity: "supplier",
    table: "suppliers",
    select: "*",
    searchColumns: ["full_name", "company_name", "code", "phone", "voen"],
    order: { column: "full_name", ascending: true },
    createPermissions: ["can_manage_suppliers"],
    label: (row) => joinLabel(text(row.company_name) || text(row.full_name), text(row.company_name) ? text(row.full_name) : ""),
    hint: partyHint,
  },
  partner: {
    // The unified counterparty (partners table: customer and / or supplier), used by payments.
    entity: "partner",
    table: "partners",
    select: "*",
    searchColumns: ["name", "full_name", "company_name", "code", "phone", "voen"],
    order: { column: "name", ascending: true },
    baseWhere: { is_deleted: false },
    // createPartnerAction checks can_manage_customers.
    createPermissions: ["can_manage_customers"],
    label: (row) => joinLabel(text(row.full_name) || text(row.company_name) || text(row.name), text(row.full_name) ? text(row.company_name) : ""),
    hint: partyHint,
  },
  consignmentPartner: {
    // Shops that sell on consignment (consignment_partners).
    entity: "consignmentPartner",
    table: "consignment_partners",
    select: "*",
    searchColumns: ["name", "company_name", "code", "phone", "voen"],
    order: { column: "name", ascending: true },
    baseWhere: { is_active: true },
    // saveConsignmentPartnerAction checks can_manage_consignments.
    createPermissions: ["can_manage_consignments"],
    label: (row) => text(row.company_name) || text(row.name),
    hint: (row) => joinHint([text(row.code), text(row.company_name) ? text(row.name) : "", text(row.phone)]),
  },
  product: {
    entity: "product",
    table: "products",
    select: "*",
    searchColumns: ["name", "code", "barcode"],
    order: { column: "name", ascending: true },
    createPermissions: ["can_manage_products"],
    label: (row) => text(row.name),
    hint: (row) => joinHint([text(row.code), row.is_service ? "" : `${stockText(row.stock)} ${text(row.unit)}`.trim()]),
  },
  warehouse: {
    entity: "warehouse",
    table: "warehouses",
    select: "*",
    searchColumns: ["name", "code"],
    order: { column: "name", ascending: true },
    createPermissions: ["can_manage_warehouses"],
    label: (row) => text(row.name),
    hint: (row) => joinHint([text(row.code), text(row.location)]),
  },
  account: {
    entity: "account",
    table: "accounts",
    select: "*",
    searchColumns: ["name", "code"],
    order: { column: "name", ascending: true },
    createPermissions: ["can_manage_finance"],
    label: (row) => text(row.name),
    hint: (row) => joinHint([text(row.code), text(row.type)]),
  },
  employee: {
    entity: "employee",
    table: "employees",
    select: "*",
    searchColumns: ["full_name", "employee_code", "phone"],
    order: { column: "full_name", ascending: true },
    createPermissions: ["can_manage_hr"],
    label: (row) => text(row.full_name),
    hint: (row) => joinHint([text(row.employee_code) || text(row.code), text(row.role), text(row.phone)]),
  },
  expenseCategory: {
    entity: "expenseCategory",
    table: "financial_categories",
    select: "id,name,type,parent_id,is_active",
    searchColumns: ["name"],
    order: { column: "name", ascending: true },
    baseWhere: { type: "EXPENSE", is_active: true },
    // quickCreateExpenseCategoryAction: anyone who writes invoices, purchases, cash or expenses.
    createPermissions: ["can_create_invoice", "can_view_purchases", "can_manage_finance", "can_manage_expenses"],
    label: (row) => text(row.name),
    hint: () => undefined,
  },
  productCategory: {
    entity: "productCategory",
    table: "categories",
    select: "*",
    searchColumns: ["name"],
    order: { column: "name", ascending: true },
    createPermissions: ["can_manage_products"],
    label: (row) => text(row.name),
    hint: () => undefined,
  },
};

export function lookupDef(entity: LookupEntity): LookupEntityDef {
  return LOOKUP_REGISTRY[entity];
}

/**
 * May this user quick-create the entity? Admins always; otherwise any one of the entity's
 * permissions. `allowCreate: false` from the caller turns it off for one field.
 */
export function canQuickCreate(
  entity: LookupEntity,
  access: { isAdmin: boolean; can: (permission: string) => boolean },
  allowCreate = true
): boolean {
  if (!allowCreate) return false;
  if (access.isAdmin) return true;
  return LOOKUP_REGISTRY[entity].createPermissions.some((permission) => access.can(permission));
}

/** The react-query key every lookup of an entity shares; invalidated after a quick-create. */
export function lookupQueryKey(entity: LookupEntity, ...rest: ReadonlyArray<string | number | null>): readonly unknown[] {
  return ["lookup", entity, ...rest];
}

/** i18n key of the entity's name ("Müştəri", "Customer", "Клиент"). */
export function entityNameKey(entity: LookupEntity): string {
  return `lookup.entities.${entity}`;
}
