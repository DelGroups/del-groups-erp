/**
 * Weather widget (prompt 24b): Open-Meteo (no API key; only the city name or its coordinates are
 * sent, no personal data). Pure parsing and the condition map; the server route fetches and
 * caches for 30 minutes per city and serves the last value when a fetch fails.
 */

export type WeatherCondition = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "storm";

export const DEFAULT_CITY = "Baku";
export const WEATHER_CACHE_MS = 30 * 60_000;

export interface WeatherDay {
  date: string;
  condition: WeatherCondition;
  max: number;
  min: number;
}

export interface WeatherReport {
  city: string;
  country: string | null;
  temperature: number;
  condition: WeatherCondition;
  /** Next days (up to 3, from tomorrow). */
  days: WeatherDay[];
  /** When the values were fetched (ISO). */
  fetchedAt: string;
  /** The fetch failed and this is the last good value. */
  stale?: boolean;
}

/** WMO weather interpretation codes → our condition (and icon). */
export function conditionFromCode(code: unknown): WeatherCondition {
  const c = Number(code);
  if (!Number.isFinite(c)) return "cloudy";
  if (c === 0) return "clear";
  if (c <= 2) return "partly";
  if (c === 3) return "cloudy";
  if (c === 45 || c === 48) return "fog";
  if (c >= 51 && c <= 57) return "drizzle";
  if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return "rain";
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return "snow";
  if (c >= 95) return "storm";
  return "cloudy";
}

/** A city the user typed: letters, spaces, dots, hyphens and apostrophes, at most 60 characters. */
export function cleanCity(value: unknown): string | null {
  const s = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!s || s.length > 60 || !/^[\p{L}\p{M} .'-]+$/u.test(s)) return null;
  return s;
}

export function geocodeUrl(city: string): string {
  return `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&format=json`;
}

export function forecastUrl(lat: number, lon: number): string {
  const p = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: "temperature_2m,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    timezone: "auto",
    forecast_days: "4",
  });
  return `https://api.open-meteo.com/v1/forecast?${p.toString()}`;
}

export function parseGeocode(body: unknown): { name: string; country: string | null; lat: number; lon: number } | null {
  const r = (body as { results?: unknown[] } | null)?.results?.[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  const lat = Number(r.latitude);
  const lon = Number(r.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { name: String(r.name ?? ""), country: (r.country as string) || null, lat, lon };
}

export function parseForecast(body: unknown, place: { name: string; country: string | null }, now: Date): WeatherReport | null {
  const b = body as { current?: Record<string, unknown>; daily?: Record<string, unknown[]> } | null;
  const temp = Number(b?.current?.temperature_2m);
  if (!b || !Number.isFinite(temp)) return null;
  const daily = b.daily ?? {};
  const dates = (daily.time ?? []) as string[];
  const days: WeatherDay[] = dates
    .map((date, i) => ({
      date: String(date),
      condition: conditionFromCode(daily.weather_code?.[i]),
      max: Math.round(Number(daily.temperature_2m_max?.[i])),
      min: Math.round(Number(daily.temperature_2m_min?.[i])),
    }))
    .filter((d) => Number.isFinite(d.max) && Number.isFinite(d.min))
    .slice(1, 4);
  return {
    city: place.name,
    country: place.country,
    temperature: Math.round(temp),
    condition: conditionFromCode(b.current?.weather_code),
    days,
    fetchedAt: now.toISOString(),
  };
}
