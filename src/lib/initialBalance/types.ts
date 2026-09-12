export type InitialBalanceStatus = "draft" | "posted" | "cancelled";

export interface InitialBalanceLineItem {
  id: string;
  product_id: string;
  product_code: string;
  product_name: string;
  unit: string;
  quantity: number;
  unit_cost: number;
  line_total: number;
  is_metric: boolean;
  metric_total_meters: number;
  piece_lengths_input: string;
}

export interface InitialBalanceDocument {
  id: string;
  document_number: string;
  doc_date: string;
  warehouse_id: string;
  warehouse_name: string | null;
  notes: string | null;
  status: InitialBalanceStatus;
  total_amount: number;
  created_by_name: string | null;
  posted_at: string | null;
  created_at: string;
  items?: InitialBalanceLineItem[];
}

export interface SaveInitialBalanceInput {
  id?: string | null;
  doc_date: string;
  warehouse_id: string;
  warehouse_name: string;
  notes?: string;
  items: Array<{
    product_id: string;
    product_code: string;
    product_name: string;
    unit: string;
    quantity: number;
    unit_cost: number;
    line_total: number;
    is_metric: boolean;
    metric_total_meters: number | null;
    piece_lengths: number[] | null;
  }>;
}
