import type { WarehouseSlip, WarehouseSlipItem, WarehouseSlipType } from "@/types/database.types";

function slipPrefix(type: WarehouseSlipType): string {
  switch (type) {
    case "inbound":
      return "IN";
    case "outbound":
      return "OUT";
    case "waste":
      return "WST";
  }
}

export function generateWarehouseSlipNumber(type: WarehouseSlipType): string {
  const year = new Date().getFullYear();
  const seq = Math.floor(10000 + Math.random() * 90000);
  return `WS-${slipPrefix(type)}-${year}-${seq}`;
}

export function parseWarehouseSlipItems(raw: unknown): WarehouseSlipItem[] {
  if (!Array.isArray(raw)) return [];
  return raw as WarehouseSlipItem[];
}

export function mapWarehouseSlipFromRow(row: Record<string, unknown>): WarehouseSlip {
  return {
    id: row.id as string,
    slip_number: row.slip_number as string,
    type: row.type as WarehouseSlip["type"],
    status: row.status as WarehouseSlip["status"],
    source_document_id: (row.source_document_id as string) || null,
    source_document_no: (row.source_document_no as string) || null,
    source_type: (row.source_type as WarehouseSlip["source_type"]) || null,
    warehouse_id: (row.warehouse_id as string) || null,
    warehouse_name: (row.warehouse_name as string) || null,
    items: parseWarehouseSlipItems(row.items),
    notes: (row.notes as string) || null,
    created_by: (row.created_by as string) || null,
    approved_by: (row.approved_by as string) || null,
    created_at: (row.created_at as string) || null,
    approved_at: (row.approved_at as string) || null,
    delivery_due_at: (row.delivery_due_at as string) || null,
  };
}
