import { supabase } from "@/lib/supabase";

export type ContractType = "sale" | "purchase";
export type ContractStatus = "active" | "completed" | "cancelled";

export interface Contract {
  id: string;
  contract_number: string;
  party_id: string;
  party_name: string | null;
  type: ContractType;
  title: string;
  total_amount: number;
  status: ContractStatus;
  voen: string | null;
  created_at: string | null;
}

export interface ContractInput {
  contract_number: string;
  party_id: string;
  party_name?: string | null;
  type: ContractType;
  title: string;
  total_amount?: number;
  status?: ContractStatus;
  voen?: string | null;
}

function toContract(row: Record<string, unknown>): Contract {
  return {
    id: String(row.id),
    contract_number: String(row.contract_number ?? ""),
    party_id: String(row.party_id ?? ""),
    party_name: row.party_name != null ? String(row.party_name) : null,
    type: row.type === "purchase" ? "purchase" : "sale",
    title: String(row.title ?? ""),
    total_amount: Number(row.total_amount) || 0,
    status:
      row.status === "completed" || row.status === "cancelled"
        ? (row.status as ContractStatus)
        : "active",
    voen: row.voen != null ? String(row.voen) : null,
    created_at: row.created_at != null ? String(row.created_at) : null,
  };
}

export async function fetchContracts(filters?: {
  type?: ContractType;
  partyId?: string;
  status?: ContractStatus;
}): Promise<Contract[]> {
  let query = supabase
    .from("contracts")
    .select("*")
    .order("created_at", { ascending: false });

  if (filters?.type) query = query.eq("type", filters.type);
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
      total_amount: input.total_amount ?? 0,
      status: input.status ?? "active",
      voen: input.voen?.trim() || null,
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
  const prefix = type === "sale" ? "SAT" : "AL";
  const stamp = Date.now().toString(36).toUpperCase();
  return `${prefix}-${stamp}`;
}
