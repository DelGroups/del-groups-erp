import { supabase } from "@/lib/supabase";

export type ContractType = "sale" | "purchase" | "service";
export type ContractStatus = "active" | "completed" | "cancelled";

export interface Contract {
  id: string;
  contract_number: string;
  party_id: string;
  party_name: string | null;
  type: ContractType;
  title: string;
  total_amount: number | null;
  status: ContractStatus;
  voen: string | null;
  advance_percentage: number | null;
  payment_stages: number | null;
  payment_terms_notes: string | null;
  contract_date: string | null;
  expiry_date: string | null;
  created_at: string | null;
}

export interface ContractInput {
  contract_number: string;
  party_id: string;
  party_name?: string | null;
  type: ContractType;
  title: string;
  total_amount?: number | null;
  status?: ContractStatus;
  voen?: string | null;
  advance_percentage?: number | null;
  payment_stages?: number | null;
  payment_terms_notes?: string | null;
  contract_date?: string | null;
  expiry_date?: string | null;
}

function normalizeContractType(value: unknown): ContractType {
  if (value === "purchase" || value === "service") return value;
  return "sale";
}

function toContract(row: Record<string, unknown>): Contract {
  const totalAmount = row.total_amount;
  return {
    id: String(row.id),
    contract_number: String(row.contract_number ?? ""),
    party_id: String(row.party_id ?? ""),
    party_name: row.party_name != null ? String(row.party_name) : null,
    type: normalizeContractType(row.type),
    title: String(row.title ?? ""),
    total_amount:
      totalAmount == null || totalAmount === ""
        ? null
        : Number(totalAmount) || 0,
    status:
      row.status === "completed" || row.status === "cancelled"
        ? (row.status as ContractStatus)
        : "active",
    voen: row.voen != null ? String(row.voen) : null,
    advance_percentage:
      row.advance_percentage != null ? Number(row.advance_percentage) : null,
    payment_stages: row.payment_stages != null ? Number(row.payment_stages) : null,
    payment_terms_notes:
      row.payment_terms_notes != null ? String(row.payment_terms_notes) : null,
    contract_date: row.contract_date != null ? String(row.contract_date) : null,
    expiry_date: row.expiry_date != null ? String(row.expiry_date) : null,
    created_at: row.created_at != null ? String(row.created_at) : null,
  };
}

export function contractTypesForTransaction(
  transactionType: "sale" | "purchase"
): ContractType[] {
  return transactionType === "purchase" ? ["purchase"] : ["sale", "service"];
}

export function getContractTypeLabel(
  type: ContractType,
  t: (key: string) => string
): string {
  if (type === "purchase") return t("official.typePurchase");
  if (type === "service") return t("official.typeService");
  return t("official.typeSale");
}

export function formatContractOptionLabel(
  contract: Contract,
  t: (key: string) => string
): string {
  const typeLabel = getContractTypeLabel(contract.type, t);
  const parts: string[] = [];
  if (contract.advance_percentage != null && contract.advance_percentage > 0) {
    parts.push(`${t("official.advanceShort")}: ${contract.advance_percentage}%`);
  }
  if (contract.payment_stages != null && contract.payment_stages > 0) {
    parts.push(`${t("official.stageShort")}: ${contract.payment_stages}`);
  }
  const suffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  return `${contract.contract_number} - ${typeLabel}${suffix}`;
}

export async function fetchContracts(filters?: {
  type?: ContractType;
  types?: ContractType[];
  partyId?: string;
  status?: ContractStatus;
}): Promise<Contract[]> {
  let query = supabase
    .from("contracts")
    .select("*")
    .order("created_at", { ascending: false });

  if (filters?.types?.length) {
    query = query.in("type", filters.types);
  } else if (filters?.type) {
    query = query.eq("type", filters.type);
  }
  if (filters?.partyId) query = query.eq("party_id", filters.partyId);
  if (filters?.status) query = query.eq("status", filters.status);

  const { data, error } = await query;
  if (error) {
    console.error("fetchContracts:", error.message);
    return [];
  }
  return (data || []).map((row) => toContract(row as Record<string, unknown>));
}

export async function createContract(
  input: ContractInput
): Promise<{ ok: true; contract: Contract } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("contracts")
    .insert({
      contract_number: input.contract_number.trim(),
      party_id: input.party_id,
      party_name: input.party_name ?? null,
      type: input.type,
      title: input.title.trim(),
      total_amount: input.total_amount ?? null,
      status: input.status ?? "active",
      voen: input.voen?.trim() || null,
      advance_percentage: input.advance_percentage ?? null,
      payment_stages: input.payment_stages ?? null,
      payment_terms_notes: input.payment_terms_notes?.trim() || null,
      contract_date: input.contract_date ?? null,
      expiry_date: input.expiry_date ?? null,
    })
    .select("*")
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, contract: toContract(data as Record<string, unknown>) };
}

export async function updateContract(
  id: string,
  patch: Partial<ContractInput>
): Promise<{ ok: true; contract: Contract } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("contracts")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, contract: toContract(data as Record<string, unknown>) };
}

export function generateContractNumber(type: ContractType): string {
  const prefix = type === "purchase" ? "AL" : type === "service" ? "XID" : "SAT";
  const stamp = Date.now().toString(36).toUpperCase();
  return `${prefix}-${stamp}`;
}
