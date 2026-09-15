import {
  API_KEY_PLACEHOLDER,
  BARCODE_PLACEHOLDER,
  type BarcodeLookupApiConfig,
  isCustomBarcodeLookupEnabled,
} from "@/lib/barcode/lookupApiConfig";

export interface BarcodeLookupData {
  name: string;
  image_url: string | null;
  category: string | null;
}

export interface BarcodeLookupResult {
  found: boolean;
  data?: BarcodeLookupData;
  error?: string;
  source?: "custom" | "open_food_facts";
}

const LOOKUP_TIMEOUT_MS = 12_000;

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstImage(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.trim()) return item.trim();
    }
  }
  return null;
}

function firstCategory(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.split(",")[0]?.trim() || null;
  }
  return null;
}

export function normalizeBarcodeLookupPayload(payload: unknown): BarcodeLookupData | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;

  const product =
    (Array.isArray(root.products) && root.products[0] && typeof root.products[0] === "object"
      ? (root.products[0] as Record<string, unknown>)
      : null) ??
    (root.product && typeof root.product === "object"
      ? (root.product as Record<string, unknown>)
      : null) ??
    root;

  const row = product as Record<string, unknown>;

  const name = firstString(
    row.title,
    row.product_name,
    row.product_name_en,
    row.name,
    row.description
  );
  if (!name) return null;

  const image_url = firstImage(row.image_url ?? row.image_front_url ?? row.images ?? row.image);
  const category = firstCategory(row.category ?? row.categories);

  return { name, image_url, category };
}

function buildCustomLookupUrl(config: BarcodeLookupApiConfig, barcode: string): string {
  const encodedBarcode = encodeURIComponent(barcode);
  const encodedKey = encodeURIComponent(config.custom_api_key);

  let url = config.custom_api_endpoint_url
    .replaceAll(BARCODE_PLACEHOLDER, encodedBarcode)
    .replaceAll(API_KEY_PLACEHOLDER, encodedKey);

  if (
    config.custom_api_key &&
    !config.custom_api_endpoint_url.includes(API_KEY_PLACEHOLDER) &&
    !url.includes(config.custom_api_key)
  ) {
    const separator = url.includes("?") ? "&" : "?";
    url = `${url}${separator}key=${encodedKey}`;
  }

  return url;
}

async function fetchJson(url: string, apiKey?: string): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (apiKey && !url.includes("key=") && !url.includes(API_KEY_PLACEHOLDER)) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`API cavabı uğursuz oldu (${response.status})`);
  }

  return response.json() as Promise<unknown>;
}

export async function lookupBarcodeWithConfig(
  barcode: string,
  config: BarcodeLookupApiConfig
): Promise<BarcodeLookupResult> {
  const code = barcode.trim();
  if (!code) {
    return { found: false, error: "Barkod boşdur" };
  }

  if (isCustomBarcodeLookupEnabled(config)) {
    try {
      const url = buildCustomLookupUrl(config, code);
      const payload = await fetchJson(url, config.custom_api_key);
      const data = normalizeBarcodeLookupPayload(payload);
      if (!data) {
        return { found: false, source: "custom", error: "Məhsul tapılmadı" };
      }
      return { found: true, data, source: "custom" };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Xüsusi API sorğusu uğursuz oldu";
      return { found: false, source: "custom", error: message };
    }
  }

  try {
    const url = `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(code)}.json`;
    const payload = (await fetchJson(url)) as {
      status?: number;
      product?: Record<string, unknown>;
    };

    if (payload.status !== 1 || !payload.product) {
      return { found: false, source: "open_food_facts", error: "Məhsul tapılmadı" };
    }

    const data = normalizeBarcodeLookupPayload({ product: payload.product });
    if (!data) {
      return { found: false, source: "open_food_facts", error: "Məhsul tapılmadı" };
    }

    return { found: true, data, source: "open_food_facts" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Open Food Facts sorğusu uğursuz oldu";
    return { found: false, source: "open_food_facts", error: message };
  }
}
