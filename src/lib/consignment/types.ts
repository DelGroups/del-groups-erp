export const CONSIGNMENT_DISPATCH_STATUSES = ["pending", "delivered", "returned"] as const;
export type ConsignmentDispatchStatus = (typeof CONSIGNMENT_DISPATCH_STATUSES)[number];

export const CONSIGNMENT_AGING_DAYS = 90;

export const DEFAULT_CONSIGNMENT_TERMS_AZ = `1. Bu sənəd malların əmanət (konsiqnasiya) şərtləri ilə tərəfdaşa təhvilini təsdiqləyir.
2. Malın mülkiyyəti DEL GROUPS MMC-yə məxsusdur və satılana qədər anbar qalığı tərəfdaşın öhdəliyindədir.
3. Tərəfdaş aylıq satış hesabatı təqdim edir; satılan miqdar əmanət qalığından çox ola bilməz.
4. Satılmayan mallar şirkətin tələbi ilə əsas anbara qaytarılır.
5. Zədələnmə, itki və ya qeyri-qanuni satış tərəfdaşın məsuliyyətidir.`;

export interface ConsignmentPartner {
  id: string;
  code: string;
  name: string;
  company_name: string | null;
  phone: string | null;
  address: string | null;
  voen: string | null;
  customer_id: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string | null;
}

export interface ConsignmentDispatchItem {
  product_id: string;
  product_code: string | null;
  product_name: string;
  category: string | null;
  unit: string | null;
  quantity: number;
  unit_price: number;
}

export interface ConsignmentDispatch {
  id: string;
  dispatch_no: string;
  partner_id: string;
  partner_name?: string | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
  dispatch_date: string;
  status: ConsignmentDispatchStatus;
  items: ConsignmentDispatchItem[];
  notes: string | null;
  created_at: string | null;
}

export interface ConsignmentInventoryRow {
  id: string;
  partner_id: string;
  partner_name?: string | null;
  product_id: string;
  product_code: string | null;
  product_name: string;
  category: string | null;
  unit: string | null;
  delivered_qty: number;
  sold_qty: number;
  returned_qty: number;
  remaining_qty: number;
  unit_price: number;
  last_dispatch_at: string | null;
  aging_days: number;
  is_aging: boolean;
}

export interface ConsignmentSoldItem {
  product_id: string;
  product_code: string | null;
  product_name: string;
  quantity_sold: number;
  unit_price: number;
  total_price: number;
}

export interface ConsignmentMonthlyReport {
  id: string;
  report_no: string;
  partner_id: string;
  partner_name?: string | null;
  report_period: string;
  sold_items: ConsignmentSoldItem[];
  total_amount: number;
  invoice_id: string | null;
  notes: string | null;
  created_at: string | null;
}

export interface ConsignmentReturn {
  id: string;
  return_no: string;
  partner_id: string;
  partner_name?: string | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
  return_date: string;
  items: ConsignmentDispatchItem[];
  notes: string | null;
  created_at: string | null;
}

export function remainingAfterMovement(
  delivered: number,
  sold: number,
  returned: number
): number {
  return Math.max(0, Number(delivered || 0) - Number(sold || 0) - Number(returned || 0));
}

export function agingDays(lastDispatchAt: string | null, now = Date.now()): number {
  if (!lastDispatchAt) return 0;
  const then = new Date(lastDispatchAt).getTime();
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.floor((now - then) / (1000 * 60 * 60 * 24)));
}
