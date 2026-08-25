export interface ExportCustomerRow {
  code: string | null;
  full_name: string | null;
  name: string | null;
  phone: string | null;
  company_name: string | null;
  address: string | null;
  voen: string | null;
  balance: number | null;
}

export interface ExportProductRow {
  code: string | null;
  name: string | null;
  category: string | null;
  buy_price: number | null;
  sell_price: number | null;
  stock: number | null;
  min_stock: number | null;
  unit: string | null;
}

export interface ExportInvoiceRow {
  type: "Satış" | "Alış" | string;
  documentNo: string | null;
  date: string | null;
  partyName: string | null;
  total: number | null;
  paid: number | null;
  remaining: number | null;
  status: string | null;
}

export interface ExportExpensePayrollRow {
  kind: "Xərc" | "Əmək haqqı" | string;
  reference: string | null;
  category: string | null;
  amount: number | null;
  extra: string | null;
  status: string | null;
  date: string | null;
  notes: string | null;
}

export interface SetupAccountRecord {
  id: string;
  code: string;
  name: string;
  type: "Kassa" | "Bank" | string;
  balance: number;
}
