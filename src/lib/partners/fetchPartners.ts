import { supabase } from "@/lib/supabase";
import { isInvoiceCancelled } from "@/lib/invoices/invoiceStatus";
import type {
  PartnerDashboardData,
  PartnerLedgerEntry,
  PartnerNetBalance,
  PartnerPurchaseRow,
  PartnerRecord,
  PartnerSaleRow,
} from "@/lib/partners/types";

function toAmount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapPartner(row: Record<string, unknown>): PartnerRecord {
  return {
    id: String(row.id),
    name: String(row.name || row.full_name || row.company_name || "Partner"),
    full_name: typeof row.full_name === "string" ? row.full_name : null,
    company_name: typeof row.company_name === "string" ? row.company_name : null,
    phone: typeof row.phone === "string" ? row.phone : null,
    address: typeof row.address === "string" ? row.address : null,
    voen: typeof row.voen === "string" ? row.voen : null,
    entity_type: typeof row.entity_type === "string" ? row.entity_type : "physical",
    code: typeof row.code === "string" ? row.code : null,
    is_customer: row.is_customer === true,
    is_supplier: row.is_supplier === true,
    customer_id: typeof row.customer_id === "string" ? row.customer_id : null,
    supplier_id: typeof row.supplier_id === "string" ? row.supplier_id : null,
    created_at: typeof row.created_at === "string" ? row.created_at : null,
  };
}

export async function fetchPartnerList(): Promise<PartnerRecord[]> {
  const { data, error } = await supabase
    .from("partners")
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    console.error("[partners] list", error.message);
    return [];
  }

  return (data || []).map((row) => mapPartner(row as Record<string, unknown>));
}

export async function fetchPartnerNetBalance(partnerId: string): Promise<PartnerNetBalance> {
  const [receivablesResult, payablesResult, netResult] = await Promise.all([
    supabase.rpc("compute_partner_open_receivables", { p_partner_id: partnerId }),
    supabase.rpc("compute_partner_open_payables", { p_partner_id: partnerId }),
    supabase.rpc("compute_partner_net_balance", { p_partner_id: partnerId }),
  ]);

  if (receivablesResult.error || payablesResult.error || netResult.error) {
    console.warn(
      "[partners] balance rpc",
      receivablesResult.error?.message || payablesResult.error?.message || netResult.error?.message
    );
  }

  const receivables = toAmount(receivablesResult.data);
  const payables = toAmount(payablesResult.data);
  const netBalance = netResult.error ? receivables - payables : toAmount(netResult.data);

  return { receivables, payables, netBalance };
}

function buildLedger(sales: PartnerSaleRow[], purchases: PartnerPurchaseRow[]): PartnerLedgerEntry[] {
  const events: Array<{
    id: string;
    date: string;
    type: "sale" | "purchase";
    documentNo: string;
    description: string;
    delta: number;
  }> = [];

  for (const sale of sales) {
    if (isInvoiceCancelled(sale.status)) continue;
    events.push({
      id: sale.id,
      date: sale.doc_date || "",
      type: "sale",
      documentNo: sale.doc_no || sale.id.slice(0, 8),
      description: "Satış fakturası",
      delta: toAmount(sale.remaining_balance > 0 ? sale.remaining_balance : sale.total_amount),
    });
  }

  for (const purchase of purchases) {
    if (isInvoiceCancelled(purchase.status)) continue;
    events.push({
      id: purchase.id,
      date: purchase.doc_date || "",
      type: "purchase",
      documentNo: purchase.invoice_number || purchase.id.slice(0, 8),
      description: "Alış fakturası",
      delta: -toAmount(purchase.debt_amount > 0 ? purchase.debt_amount : purchase.total_amount),
    });
  }

  events.sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return a.type.localeCompare(b.type);
  });

  let running = 0;
  return events.map((event) => {
    running += event.delta;
    const debit = event.delta > 0 ? event.delta : 0;
    const credit = event.delta < 0 ? Math.abs(event.delta) : 0;
    return {
      id: event.id,
      date: event.date,
      type: event.type,
      documentNo: event.documentNo,
      description: event.description,
      debit,
      credit,
      runningBalance: running,
    };
  });
}

export async function fetchPartnerDashboard(partnerId: string): Promise<PartnerDashboardData | null> {
  const { data: partnerRow, error: partnerError } = await supabase
    .from("partners")
    .select("*")
    .eq("id", partnerId)
    .maybeSingle();

  if (partnerError || !partnerRow) {
    console.error("[partners] detail", partnerError?.message || "not found");
    return null;
  }

  const partner = mapPartner(partnerRow as Record<string, unknown>);
  const balance = await fetchPartnerNetBalance(partnerId);

  const [{ data: salesData }, { data: purchasesData }] = await Promise.all([
    supabase
      .from("sales")
      .select("id, doc_no, doc_date, total_amount, paid_amount, remaining_balance, status")
      .eq("partner_id", partnerId)
      .order("doc_date", { ascending: false }),
    supabase
      .from("purchases")
      .select("id, invoice_number, doc_date, total_amount, paid_amount, debt_amount, status")
      .eq("partner_id", partnerId)
      .order("doc_date", { ascending: false }),
  ]);

  const sales: PartnerSaleRow[] = (salesData || []).map((row) => ({
    id: String(row.id),
    doc_no: typeof row.doc_no === "string" ? row.doc_no : null,
    doc_date: typeof row.doc_date === "string" ? row.doc_date : null,
    total_amount: toAmount(row.total_amount),
    paid_amount: toAmount(row.paid_amount),
    remaining_balance: toAmount(row.remaining_balance),
    status: typeof row.status === "string" ? row.status : null,
  }));

  const purchases: PartnerPurchaseRow[] = (purchasesData || []).map((row) => ({
    id: String(row.id),
    invoice_number: typeof row.invoice_number === "string" ? row.invoice_number : null,
    doc_date: typeof row.doc_date === "string" ? row.doc_date : null,
    total_amount: toAmount(row.total_amount),
    paid_amount: toAmount(row.paid_amount),
    debt_amount: toAmount(row.debt_amount),
    status: typeof row.status === "string" ? row.status : null,
  }));

  return {
    partner,
    balance,
    sales,
    purchases,
    ledger: buildLedger(sales, purchases),
  };
}

export async function fetchPartnersWithBalances(): Promise<
  Array<PartnerRecord & { balance: PartnerNetBalance }>
> {
  const partners = await fetchPartnerList();
  const enriched = await Promise.all(
    partners.map(async (partner) => ({
      ...partner,
      balance: await fetchPartnerNetBalance(partner.id),
    }))
  );
  return enriched;
}

export function partnerDisplayName(partner: Pick<PartnerRecord, "name" | "full_name" | "company_name">): string {
  return partner.full_name || partner.company_name || partner.name;
}
