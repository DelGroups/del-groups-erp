/** Canonical production_orders.status values enforced by production_orders_status_check. */
const DB_STATUS = ["Draft", "In-Progress", "Ready", "Delivered"] as const;

/** Canonical production_orders.type values enforced by production_orders_type_check. */
export const DB_PRODUCTION_TYPES = ["Custom", "Series"] as const;
export type DbProductionOrderType = (typeof DB_PRODUCTION_TYPES)[number];
export const DB_PRODUCTION_TYPE_DEFAULT: DbProductionOrderType = "Custom";

const STATUS_ALIASES: Record<string, (typeof DB_STATUS)[number]> = {
  "": "Draft",
  draft: "Draft",
  qaralama: "Draft",
  черновик: "Draft",
  "in-progress": "In-Progress",
  "in progress": "In-Progress",
  in_progress: "In-Progress",
  inprogress: "In-Progress",
  istehsalda: "In-Progress",
  istehsalatda: "In-Progress",
  "в работе": "In-Progress",
  "в-работе": "In-Progress",
  ready: "Ready",
  hazir: "Ready",
  hazır: "Ready",
  готово: "Ready",
  delivered: "Delivered",
  tehvil: "Delivered",
  təhvil: "Delivered",
  сдано: "Delivered",
};

const TYPE_ALIASES: Record<string, DbProductionOrderType> = {
  "": "Custom",
  custom: "Custom",
  fərdi: "Custom",
  ferdı: "Custom",
  ferdi: "Custom",
  fardi: "Custom",
  ferd: "Custom",
  individual: "Custom",
  заказной: "Custom",
  series: "Series",
  seriya: "Series",
  seria: "Series",
  serial: "Series",
  seri: "Series",
  stock: "Series",
  серия: "Series",
};

function foldKey(value: string): string {
  return value
    .trim()
    .replace(/İ/g, "I")
    .replace(/ı/g, "i")
    .toLocaleLowerCase("en-US")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/_/g, "-")
    .replace(/\s+/g, "-");
}

/**
 * Map any UI/DB/i18n variant to the exact CHECK-constraint key.
 * Always returns one of: Draft | In-Progress | Ready | Delivered.
 */
export function normalizeStatus(status: string): string {
  const trimmed = typeof status === "string" ? status.trim() : "";
  if (!trimmed) return "Draft";
  if ((DB_STATUS as readonly string[]).includes(trimmed)) return trimmed;

  const lower = trimmed.toLocaleLowerCase("en-US");
  const folded = foldKey(trimmed);
  return (
    STATUS_ALIASES[trimmed] ||
    STATUS_ALIASES[lower] ||
    STATUS_ALIASES[folded] ||
    "Draft"
  );
}

/** Map any variant to the exact CHECK-constraint key: Custom | Series. */
export function normalizeType(type: string): DbProductionOrderType {
  const trimmed = typeof type === "string" ? type.trim() : "";
  if (!trimmed) return DB_PRODUCTION_TYPE_DEFAULT;
  if ((DB_PRODUCTION_TYPES as readonly string[]).includes(trimmed)) {
    return trimmed as DbProductionOrderType;
  }

  const lower = trimmed.toLocaleLowerCase("en-US");
  const folded = foldKey(trimmed);
  return (
    TYPE_ALIASES[trimmed] ||
    TYPE_ALIASES[lower] ||
    TYPE_ALIASES[folded] ||
    DB_PRODUCTION_TYPE_DEFAULT
  );
}

function prepareProductionOrderWrite(
  payload: Record<string, unknown>,
  forceCanonical: boolean
): Record<string, unknown> {
  const next = { ...payload };
  if (forceCanonical || "type" in next) {
    next.type = normalizeType(next.type == null ? "" : String(next.type));
  }
  if (forceCanonical || "status" in next) {
    next.status = normalizeStatus(next.status == null ? "" : String(next.status));
  }
  return next;
}

/** Shared canonicalization for actions, safeQuery, and direct Supabase writes. */
export function canonicalizeProductionOrderWrite(
  payload: Record<string, unknown>,
  options?: { insert?: boolean }
): Record<string, unknown> {
  return prepareProductionOrderWrite(payload, Boolean(options?.insert));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FromClient = { from: (table: string) => any };

/** Last-mile insert: type and status are always present and canonical before PostgREST. */
export function insertProductionOrders(
  client: FromClient,
  rows: Record<string, unknown> | Record<string, unknown>[]
) {
  const list = (Array.isArray(rows) ? rows : [rows]).map((row) =>
    prepareProductionOrderWrite(row, true)
  );
  return client.from("production_orders").insert(list);
}

/** Last-mile update: if type/status are in the payload, they are canonical before PostgREST. */
export function updateProductionOrders(client: FromClient, payload: Record<string, unknown>) {
  return client.from("production_orders").update(prepareProductionOrderWrite(payload, false));
}
