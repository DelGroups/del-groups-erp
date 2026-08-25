export const BACKUP_VERSION = 1;

/** Insert order: parents before children */
export const BACKUP_TABLES = [
  "warehouses",
  "categories",
  "products",
  "accounts",
  "customers",
  "suppliers",
  "employees",
  "company_settings",
  "settings",
  "commission_rules",
  "sales",
  "sale_items",
  "purchases",
  "purchase_items",
  "expenses",
  "transactions",
  "salary_payments",
  "sales_commissions",
  "warehouse_slips",
  "inventory_writeoffs",
  "consignment_orders",
] as const;

export type BackupTableName = (typeof BACKUP_TABLES)[number];

/** Delete in reverse order to satisfy FK constraints */
export const BACKUP_DELETE_ORDER: BackupTableName[] = [...BACKUP_TABLES].reverse();

export interface SystemBackupPayload {
  version: number;
  createdAt: string;
  app: "del-groups-erp";
  tables: Partial<Record<BackupTableName, Record<string, unknown>[]>>;
}

export function buildBackupFilename(date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  return `System_Full_Backup_${day}.json`;
}
