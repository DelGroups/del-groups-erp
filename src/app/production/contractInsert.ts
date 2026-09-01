import { formatProductionDbError, productionSchemaColumnFromError } from "@/lib/production/payloads";
import { remainingBalanceFromOrder, type ProductionOrder } from "@/lib/production/types";
import { isMissingTableError, missingColumnFromError } from "@/lib/production/safeQuery";

/** Core columns expected on production_contracts reads. */
export const PRODUCTION_CONTRACT_CORE_SELECT_COLUMNS = ["id", "production_order_id"] as const;

/** Optional read columns — dropped individually when missing from schema cache. */
export const PRODUCTION_CONTRACT_OPTIONAL_SELECT_COLUMNS = [
  "customer_id",
  "client_id",
  "customer_name",
  "contract_no",
  "contract_number",
  "contract_date",
  "delivery_date",
  "expected_delivery_date",
  "advance_payment",
  "deposit_amount",
  "remaining_balance",
  "total_amount",
  "total_project_price",
  "installation_fee",
  "transport_fee",
  "discount_amount",
  "project_name",
  "project_scope",
  "terms",
  "content",
  "status",
  "notes",
] as const;

/**
 * Strict PostgREST write whitelist — ONLY these keys may reach production_contracts insert/update/upsert.
 */
export const PRODUCTION_CONTRACT_DB_INSERT_KEYS = [
  "production_order_id",
  "customer_id",
  "customer_name",
  "project_name",
  "project_scope",
  "contract_no",
  "contract_number",
  "contract_date",
  "expected_delivery_date",
  "advance_payment",
  "total_amount",
  "remaining_balance",
  "installation_fee",
  "transport_fee",
  "discount_amount",
  "notes",
  "content",
  "status",
] as const;

/** @deprecated Alias for strict DB insert keys. */
export const PRODUCTION_CONTRACT_INSERT_KEYS = PRODUCTION_CONTRACT_DB_INSERT_KEYS;

const FOLD_TEXT_INTO_NOTES: Record<string, string> = {
  contract_date: "notes",
  expected_delivery_date: "notes",
  contract_no: "notes",
  contract_number: "notes",
  customer_id: "notes",
  project_name: "notes",
  project_scope: "notes",
  content: "notes",
  status: "notes",
};

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function textOrNull(value: unknown): string | null {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  return text || null;
}

/** Normalize any date input to YYYY-MM-DD for PostgREST DATE columns. */
export function formatContractDateYmd(value: unknown, fallback?: unknown): string {
  const candidates = [value, fallback, new Date()];
  for (const candidate of candidates) {
    if (candidate == null || candidate === "") continue;
    if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) {
      return candidate.toISOString().slice(0, 10);
    }
    const text = String(candidate).trim();
    if (!text) continue;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const isoPrefix = text.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoPrefix?.[1]) return isoPrefix[1];
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

export function resolveContractCustomerId(source: Record<string, unknown>): string | null {
  const raw =
    source.customer_id ??
    source.client_id ??
    (source.contract as Record<string, unknown> | undefined)?.customer_id ??
    (source.contract as Record<string, unknown> | undefined)?.client_id;
  return textOrNull(raw);
}

export function resolveContractCustomerName(source: Record<string, unknown>): string | null {
  const raw =
    source.customer_name ??
    (source.contract as Record<string, unknown> | undefined)?.customer_name;
  return textOrNull(raw);
}

export function resolveContractProjectName(source: Record<string, unknown>): string | null {
  const raw =
    source.project_name ??
    (source.contract as Record<string, unknown> | undefined)?.project_name;
  return textOrNull(raw);
}

export function resolveContractProjectScope(source: Record<string, unknown>): string | null {
  const raw =
    source.project_scope ??
    (source.contract as Record<string, unknown> | undefined)?.project_scope;
  return textOrNull(raw);
}

export function resolveContractNumber(source: Record<string, unknown>): string | null {
  const raw =
    source.contract_no ??
    source.contract_number ??
    source.order_no ??
    (source.contract as Record<string, unknown> | undefined)?.contract_no ??
    (source.contract as Record<string, unknown> | undefined)?.contract_number;
  return textOrNull(raw);
}

export function resolveContractTotalAmount(source: Record<string, unknown>): number {
  if (source.total_amount != null && source.total_amount !== "") {
    return toNumber(source.total_amount);
  }
  const projectPrice = toNumber(source.total_project_price);
  const installationFee = toNumber(source.installation_fee);
  if (projectPrice > 0 || installationFee > 0) {
    return projectPrice + installationFee;
  }
  return projectPrice;
}

export function resolveContractInstallationFee(source: Record<string, unknown>): number {
  return toNumber(source.installation_fee ?? 0);
}

export function resolveContractTransportFee(source: Record<string, unknown>): number {
  return toNumber(source.transport_fee ?? 0);
}

export function resolveContractDiscountAmount(source: Record<string, unknown>): number {
  return toNumber(source.discount_amount ?? 0);
}

export function resolveContractDeliveryDate(source: Record<string, unknown>): string | null {
  const raw =
    source.expected_delivery_date ??
    source.delivery_date ??
    (source.contract as Record<string, unknown> | undefined)?.expected_delivery_date ??
    (source.contract as Record<string, unknown> | undefined)?.delivery_date;
  if (raw == null || raw === "") return null;
  return formatContractDateYmd(raw);
}

export function resolveContractDate(source: Record<string, unknown>): string {
  return formatContractDateYmd(
    source.contract_date ?? source.contractDate ?? source.signed_date,
    source.created_at ?? source.expected_delivery_date ?? source.delivery_date
  );
}

export function resolveContractAdvancePayment(source: Record<string, unknown>): number {
  const raw =
    source.advance_payment ??
    source.deposit_amount ??
    (source.contract as Record<string, unknown> | undefined)?.advance_payment ??
    (source.contract as Record<string, unknown> | undefined)?.deposit_amount;
  if (raw == null || raw === "") return 0;
  return toNumber(raw);
}

export function resolveContractRemainingBalance(source: Record<string, unknown>): number {
  const raw =
    source.remaining_balance ??
    source.remaining_amount ??
    (source.contract as Record<string, unknown> | undefined)?.remaining_balance;
  if (raw != null && raw !== "") {
    return Number(raw) || 0;
  }
  return remainingBalanceFromOrder({
    total_project_price: source.total_project_price ?? resolveContractTotalAmount(source),
    installation_fee: source.installation_fee,
    advance_payment: resolveContractAdvancePayment(source),
  });
}

export function resolveContractContent(source: Record<string, unknown>): string | null {
  if (typeof source.content === "string" && source.content.trim()) {
    return source.content.trim();
  }
  const chunks = [
    typeof source.terms === "string" ? source.terms.trim() : "",
  ].filter(Boolean);
  if (!chunks.length) return null;
  return [...new Set(chunks)].join("\n\n");
}

export function resolveContractStatus(source: Record<string, unknown>): string {
  const raw = source.status ?? (source.contract as Record<string, unknown> | undefined)?.status;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return "draft";
}

/** @deprecated Use resolveContractDeliveryDate — kept for callers expecting both fields. */
export function resolveContractDeliveryDateFields(
  source: Record<string, unknown>
): { delivery_date: string | null; expected_delivery_date: string | null } {
  const ymd = resolveContractDeliveryDate(source);
  return { delivery_date: ymd, expected_delivery_date: ymd };
}

export function contractSelectColumns(dropped = new Set<string>()): string {
  return [...PRODUCTION_CONTRACT_CORE_SELECT_COLUMNS, ...PRODUCTION_CONTRACT_OPTIONAL_SELECT_COLUMNS]
    .filter((column) => !dropped.has(column))
    .join(",");
}

export function isProductionContractSelectColumn(column: string): boolean {
  return (
    (PRODUCTION_CONTRACT_CORE_SELECT_COLUMNS as readonly string[]).includes(column) ||
    (PRODUCTION_CONTRACT_OPTIONAL_SELECT_COLUMNS as readonly string[]).includes(column)
  );
}

export function isProductionContractSchemaColumnError(message?: string | null): boolean {
  if (!message) return false;
  return /schema cache|Could not find the '[^']+' column/i.test(message);
}

/** Final gate: copy ONLY whitelisted DB columns — never pass through unknown keys. */
export function pickStrictContractDbPayload(normalized: Record<string, unknown>): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const key of PRODUCTION_CONTRACT_DB_INSERT_KEYS) {
    if (!(key in normalized)) continue;
    const value = normalized[key];
    if (value == null || value === "") {
      if (
        key === "customer_id" ||
        key === "customer_name" ||
        key === "project_name" ||
        key === "project_scope" ||
        key === "contract_no" ||
        key === "contract_number" ||
        key === "expected_delivery_date" ||
        key === "notes" ||
        key === "content"
      ) {
        continue;
      }
    }
    record[key] = value;
  }
  return record;
}

/** Hard purge — guarantees no leaked UI/order keys reach Supabase. */
export function enforceStrictContractDbPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const strict: Record<string, unknown> = {};
  for (const key of PRODUCTION_CONTRACT_DB_INSERT_KEYS) {
    if (key in payload) strict[key] = payload[key];
  }
  return strict;
}

function rebuildContractPayload(
  source: Record<string, unknown>,
  droppedColumns: ReadonlySet<string>
): Record<string, unknown> {
  let payload = enforceStrictContractDbPayload(buildCleanContractPayload(source));

  for (const column of droppedColumns) {
    payload = foldContractFieldIntoPayload(payload, column, source, droppedColumns);
  }

  for (const column of droppedColumns) {
    delete payload[column];
  }

  return enforceStrictContractDbPayload(payload);
}

/**
 * Build the ONLY object shape sent to Supabase for production_contracts writes.
 * Transient UI / order fields are mapped explicitly — never spread into the payload.
 */
export function buildCleanContractPayload(data: Record<string, unknown>): Record<string, unknown> {
  const contractNo = resolveContractNumber(data);
  const expectedDelivery = resolveContractDeliveryDate(data);

  const cleanContractPayload = {
    production_order_id: String(data.production_order_id ?? ""),
    customer_id: resolveContractCustomerId(data),
    customer_name: resolveContractCustomerName(data),
    project_name: resolveContractProjectName(data) || null,
    project_scope: resolveContractProjectScope(data) || null,
    contract_no: contractNo,
    contract_number: contractNo,
    contract_date: formatContractDateYmd(
      data.contract_date ?? data.contractDate,
      data.created_at ?? new Date()
    ),
    expected_delivery_date: expectedDelivery,
    advance_payment: Number(resolveContractAdvancePayment(data) || 0),
    total_amount: Number((data.total_amount ?? resolveContractTotalAmount(data)) || 0),
    remaining_balance: Number(data.remaining_balance ?? data.remaining_amount ?? 0),
    installation_fee: Number((data.installation_fee ?? resolveContractInstallationFee(data)) || 0),
    transport_fee: Number((data.transport_fee ?? resolveContractTransportFee(data)) || 0),
    discount_amount: Number((data.discount_amount ?? resolveContractDiscountAmount(data)) || 0),
    notes: textOrNull(data.notes),
    content: resolveContractContent(data),
    status: resolveContractStatus(data),
  };

  return pickStrictContractDbPayload(cleanContractPayload);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sanitizeContractPayload(item: any): Record<string, unknown> {
  const data = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
  return buildCleanContractPayload(data);
}

export function buildContractMappingSourceFromOrder(
  order: ProductionOrder,
  orderId: string,
  options?: {
    contractNo?: string;
    contractDate?: string;
    terms?: string | null;
    projectScope?: string | null;
    projectName?: string | null;
    customerId?: string | null;
    customerName?: string | null;
    transportFee?: number;
    discountAmount?: number;
  }
): Record<string, unknown> {
  const contractNumber = options?.contractNo ?? resolveContractNumber(order) ?? order.order_no;

  return {
    production_order_id: orderId,
    customer_id: options?.customerId ?? order.customer_id ?? null,
    client_id: options?.customerId ?? order.customer_id ?? null,
    customer_name: options?.customerName ?? order.customer_name ?? null,
    project_name: options?.projectName ?? order.project_name ?? null,
    contract_no: contractNumber,
    contract_number: contractNumber,
    contract_date: formatContractDateYmd(
      options?.contractDate ?? order.contract?.contract_date,
      order.created_at
    ),
    expected_delivery_date: order.expected_delivery_date,
    delivery_date: order.expected_delivery_date,
    total_amount: resolveContractTotalAmount(order),
    total_project_price: order.total_project_price,
    installation_fee: order.installation_fee,
    transport_fee: options?.transportFee ?? 0,
    discount_amount: options?.discountAmount ?? 0,
    advance_payment: resolveContractAdvancePayment({
      ...order,
      ...(order.contract ? { deposit_amount: order.contract.advance_payment } : {}),
    }),
    remaining_balance: remainingBalanceFromOrder(order),
    content: resolveContractContent({
      terms: options?.terms ?? order.terms,
      project_scope: options?.projectScope ?? order.project_scope,
      project_name: options?.projectName ?? order.project_name,
    }),
    terms: options?.terms ?? order.terms,
    project_scope: options?.projectScope ?? order.project_scope,
    notes: order.notes,
    order_no: order.order_no,
    created_at: order.created_at,
  };
}

export function buildContractPayloadFromOrder(
  order: ProductionOrder,
  orderId: string,
  options?: {
    contractNo?: string;
    contractDate?: string;
    terms?: string | null;
    projectScope?: string | null;
    projectName?: string | null;
    customerId?: string | null;
    customerName?: string | null;
    transportFee?: number;
    discountAmount?: number;
  }
): Record<string, unknown> {
  return buildCleanContractPayload(buildContractMappingSourceFromOrder(order, orderId, options));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildStrictContractInsertPayload(item: any): Record<string, unknown> {
  return sanitizeContractPayload(item);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FromClient = { from: (table: string) => any };

export async function selectProductionContractRow(
  admin: FromClient,
  orderId: string
): Promise<{ data: Record<string, unknown> | null; error: string | null }> {
  const dropped = new Set<string>();
  let columns = contractSelectColumns(dropped);

  for (let attempt = 0; attempt < 16; attempt++) {
    const { data, error } = await admin
      .from("production_contracts")
      .select(columns)
      .eq("production_order_id", orderId)
      .maybeSingle();

    if (!error) {
      return { data: (data as Record<string, unknown> | null) ?? null, error: null };
    }

    if (isMissingTableError(error, "production_contracts")) {
      return { data: null, error: null };
    }

    const missing = missingColumnFromError(error);
    if (!missing || !isProductionContractSelectColumn(missing) || dropped.has(missing)) {
      return { data: null, error: formatProductionDbError(error?.message) };
    }

    dropped.add(missing);
    columns = contractSelectColumns(dropped);
    if (!columns) {
      return { data: null, error: formatProductionDbError(error?.message) };
    }
  }

  return { data: null, error: "production_contracts schema mismatch" };
}

function foldContractFieldIntoPayload(
  payload: Record<string, unknown>,
  blocked: string,
  source: Record<string, unknown>,
  droppedColumns: ReadonlySet<string> = new Set()
): Record<string, unknown> {
  const next = { ...payload };

  if (blocked === "customer_id") {
    delete next.customer_id;
    const customerName = resolveContractCustomerName(source);
    if (customerName && !next.customer_name) next.customer_name = customerName;
    return pickStrictContractDbPayload(next);
  }

  if (blocked === "contract_no") {
    delete next.contract_no;
    if (!next.contract_number) next.contract_number = resolveContractNumber(source);
    return pickStrictContractDbPayload(next);
  }

  if (blocked === "contract_number") {
    delete next.contract_number;
    if (!next.contract_no) next.contract_no = resolveContractNumber(source);
    return pickStrictContractDbPayload(next);
  }

  if (blocked === "advance_payment") {
    delete next.advance_payment;
    return pickStrictContractDbPayload(next);
  }

  if (blocked === "remaining_balance") {
    delete next.remaining_balance;
    return pickStrictContractDbPayload(next);
  }

  if (blocked === "expected_delivery_date") {
    delete next.expected_delivery_date;
    return enforceStrictContractDbPayload(next);
  }

  if (blocked === "project_name") {
    delete next.project_name;
    const projectName = resolveContractProjectName(source);
    if (projectName) {
      const label = `Layihə: ${projectName}`;
      const foldInto =
        droppedColumns.has("content") || droppedColumns.has("notes") ? "notes" : "content";
      const existing = typeof next[foldInto] === "string" ? String(next[foldInto]).trim() : "";
      next[foldInto] = existing ? `${label}\n\n${existing}` : label;
    }
    return enforceStrictContractDbPayload(next);
  }

  if (blocked === "project_scope") {
    delete next.project_scope;
    const projectScope = resolveContractProjectScope(source);
    if (projectScope) {
      const label = `İş həcmi: ${projectScope}`;
      const foldInto =
        droppedColumns.has("content") || droppedColumns.has("notes") ? "notes" : "content";
      const existing = typeof next[foldInto] === "string" ? String(next[foldInto]).trim() : "";
      next[foldInto] = existing ? `${label}\n\n${existing}` : label;
    }
    return enforceStrictContractDbPayload(next);
  }

  if (!(blocked in next)) {
    return enforceStrictContractDbPayload(next);
  }

  const foldInto = FOLD_TEXT_INTO_NOTES[blocked];
  if (foldInto) {
    const value = next[blocked];
    if (typeof value === "string" && value.trim()) {
      const extra = value.trim();
      const existing = typeof next[foldInto] === "string" ? String(next[foldInto]).trim() : "";
      next[foldInto] = existing ? `${existing}\n\n${extra}` : extra;
    } else if (value != null && value !== "" && typeof value !== "number") {
      const existing = typeof next[foldInto] === "string" ? String(next[foldInto]).trim() : "";
      next[foldInto] = existing ? `${existing}\n\n${blocked}: ${String(value)}` : `${blocked}: ${String(value)}`;
    }
  }

  delete next[blocked];
  return pickStrictContractDbPayload(next);
}

/** Insert or update — never sends raw form/order objects; only strict DB columns. */
export async function persistSanitizedContractRow(
  admin: FromClient,
  options: { existingId?: string | null; source: Record<string, unknown> }
): Promise<{ data: { id: string } | null; error: string | null; droppedColumns: string[] }> {
  const dropped = new Set<string>();
  let payload = rebuildContractPayload(options.source, dropped);

  for (let attempt = 0; attempt < 24; attempt++) {
    payload = enforceStrictContractDbPayload(payload);

    const { data, error } = options.existingId
      ? await admin
          .from("production_contracts")
          .update(payload)
          .eq("id", options.existingId)
          .select("id")
          .maybeSingle()
      : await admin.from("production_contracts").insert([payload]).select("id").maybeSingle();

    if (!error && data) {
      return { data: data as { id: string }, error: null, droppedColumns: [...dropped] };
    }

    if (isMissingTableError(error, "production_contracts")) {
      return { data: null, error: formatProductionDbError(error?.message), droppedColumns: [...dropped] };
    }

    const blocked = productionSchemaColumnFromError(error) || missingColumnFromError(error);
    if (blocked && !dropped.has(blocked)) {
      dropped.add(blocked);
      payload = rebuildContractPayload(options.source, dropped);
      continue;
    }

    return {
      data: null,
      error: formatProductionDbError(error?.message || "Müqavilə saxlanılmadı"),
      droppedColumns: [...dropped],
    };
  }

  return { data: null, error: "production_contracts schema mismatch", droppedColumns: [...dropped] };
}

/** Merge unsaved detail-page form values into an order before print preview. */
export function mergeContractDetailFormState(
  order: ProductionOrder,
  form: {
    terms?: string;
    projectScope?: string;
    deliveryDate?: string;
    advance?: string | number;
    projectPrice?: string | number;
    installFee?: string | number;
    notes?: string;
    customerId?: string | null;
    customerName?: string | null;
  }
): ProductionOrder {
  const customerId = resolveContractCustomerId({
    customer_id: form.customerId ?? order.customer_id,
    client_id: form.customerId ?? order.customer_id,
    contract: order.contract,
  });
  const customerName = resolveContractCustomerName({
    customer_name: form.customerName ?? order.customer_name,
    contract: order.contract,
  });

  return {
    ...order,
    customer_id: customerId,
    customer_name: customerName,
    terms: form.terms ?? order.terms,
    project_scope: form.projectScope ?? order.project_scope,
    expected_delivery_date: form.deliveryDate || order.expected_delivery_date,
    advance_payment:
      form.advance != null && form.advance !== ""
        ? Number(form.advance) || 0
        : order.advance_payment,
    total_project_price:
      form.projectPrice != null && form.projectPrice !== ""
        ? Number(form.projectPrice) || 0
        : order.total_project_price,
    installation_fee:
      form.installFee != null && form.installFee !== ""
        ? Number(form.installFee) || 0
        : order.installation_fee,
    notes: form.notes ?? order.notes,
    contract: order.contract
      ? {
          ...order.contract,
          customer_id: customerId,
          customer_name: customerName,
          contract_no:
            resolveContractNumber({
              ...order.contract,
              order_no: order.order_no,
            }) || order.contract.contract_no,
          contract_date: resolveContractDate({
            ...order.contract,
            contract_date: order.contract.contract_date,
            created_at: order.created_at,
          }),
          expected_delivery_date: form.deliveryDate || order.contract.expected_delivery_date,
          terms: form.terms ?? order.contract.terms,
          project_scope: form.projectScope ?? order.contract.project_scope,
          advance_payment:
            form.advance != null && form.advance !== ""
              ? Number(form.advance) || 0
              : order.contract.advance_payment,
        }
      : order.contract,
  };
}

export async function upsertSanitizedContractRow(
  admin: FromClient,
  options: { source: Record<string, unknown>; onConflict?: string }
): Promise<{ data: { id: string } | null; error: string | null; droppedColumns: string[] }> {
  const dropped = new Set<string>();
  let payload = rebuildContractPayload(options.source, dropped);
  const onConflict = options.onConflict ?? "production_order_id";

  for (let attempt = 0; attempt < 24; attempt++) {
    payload = enforceStrictContractDbPayload(payload);

    const { data, error } = await admin
      .from("production_contracts")
      .upsert([payload], { onConflict })
      .select("id")
      .maybeSingle();

    if (!error && data) {
      return { data: data as { id: string }, error: null, droppedColumns: [...dropped] };
    }

    if (isMissingTableError(error, "production_contracts")) {
      return { data: null, error: formatProductionDbError(error?.message), droppedColumns: [...dropped] };
    }

    const blocked = productionSchemaColumnFromError(error) || missingColumnFromError(error);
    if (blocked && !dropped.has(blocked)) {
      dropped.add(blocked);
      payload = rebuildContractPayload(options.source, dropped);
      continue;
    }

    return {
      data: null,
      error: formatProductionDbError(error?.message || "Müqavilə saxlanılmadı"),
      droppedColumns: [...dropped],
    };
  }

  return { data: null, error: "production_contracts schema mismatch", droppedColumns: [...dropped] };
}
