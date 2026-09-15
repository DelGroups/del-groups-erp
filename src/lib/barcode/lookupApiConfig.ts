export const BARCODE_LOOKUP_API_CONFIG_KEY = "barcode_lookup_api_config";

export const BARCODE_PLACEHOLDER = "[BARCODE]";
export const API_KEY_PLACEHOLDER = "[API_KEY]";

export interface BarcodeLookupApiConfig {
  custom_api_endpoint_url: string;
  custom_api_key: string;
}

export const DEFAULT_BARCODE_LOOKUP_API_CONFIG: BarcodeLookupApiConfig = {
  custom_api_endpoint_url: "",
  custom_api_key: "",
};

export function parseBarcodeLookupApiConfig(
  value: unknown
): BarcodeLookupApiConfig {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_BARCODE_LOOKUP_API_CONFIG };
  }
  const row = value as Record<string, unknown>;
  return {
    custom_api_endpoint_url:
      typeof row.custom_api_endpoint_url === "string"
        ? row.custom_api_endpoint_url.trim()
        : "",
    custom_api_key:
      typeof row.custom_api_key === "string" ? row.custom_api_key.trim() : "",
  };
}

export function isCustomBarcodeLookupEnabled(config: BarcodeLookupApiConfig): boolean {
  return config.custom_api_endpoint_url.includes(BARCODE_PLACEHOLDER);
}

export function validateBarcodeLookupApiConfig(
  config: BarcodeLookupApiConfig
): { ok: true } | { ok: false; error: string } {
  const url = config.custom_api_endpoint_url.trim();
  if (!url) return { ok: true };
  if (!/^https:\/\//i.test(url)) {
    return { ok: false, error: "API endpoint yalnız HTTPS olmalıdır" };
  }
  if (!url.includes(BARCODE_PLACEHOLDER)) {
    return {
      ok: false,
      error: `Endpoint URL-də ${BARCODE_PLACEHOLDER} placeholder olmalıdır`,
    };
  }
  return { ok: true };
}
