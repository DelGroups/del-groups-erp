import type { Json } from "@/types/database.types";

export const AUDIT_ACTIONS = ["CREATE", "UPDATE", "DELETE"] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_MODULES = [
  "FINANCE",
  "PRODUCTION",
  "INVENTORY",
  "PAYROLL",
  "SECURITY",
] as const;
export type AuditModule = (typeof AUDIT_MODULES)[number];

export interface AuditLogRow {
  id: string;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  action: AuditAction;
  module: AuditModule;
  table_name: string | null;
  record_id: string | null;
  old_values_json: Json | null;
  new_values_json: Json | null;
  ip_address: string | null;
  created_at: string;
}

export interface AuditLogFilters {
  search?: string;
  module?: AuditModule | "";
  action?: AuditAction | "";
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface AuditLogListResult {
  rows: AuditLogRow[];
  total: number;
}
