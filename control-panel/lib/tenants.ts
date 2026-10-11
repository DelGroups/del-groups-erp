/**
 * Tenant record rules, shared by the forms, the server actions and the tests.
 * They mirror the CHECK constraints in supabase/migrations (tests/schema.test.mjs keeps
 * them in sync). No imports, so plain Node can load this file in tests.
 */

export const TENANT_STATUSES = [
  "provisioning",
  "trial",
  "active",
  "past_due",
  "read_only",
  "suspended",
  "cancelled",
] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const TENANT_LANGUAGES = ["az", "en", "ru"] as const;
export type TenantLanguage = (typeof TENANT_LANGUAGES)[number];

export interface TenantInput {
  name: string;
  slug: string;
  status: TenantStatus;
  country: string;
  language: TenantLanguage;
  currency: string;
  notes: string | null;
}

export type TenantField = keyof TenantInput;

/** i18n keys (lib/i18n/messages.ts → tenants.errors) per invalid field. */
export type TenantErrors = Partial<Record<TenantField, string>>;

export type TenantParseResult = { ok: true; value: TenantInput } | { ok: false; errors: TenantErrors };

export const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;

/** "Acme MMC" → "acme-mmc": lower case, ASCII letters/digits and single hyphens, max 40. */
export function suggestSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ə/gi, "e")
    .replace(/ı/g, "i")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

function text(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  return typeof value === "string" ? value.trim() : "";
}

/** Validates a tenant form. Returns the cleaned record or an error key per field. */
export function parseTenantInput(raw: Record<string, unknown>): TenantParseResult {
  const errors: TenantErrors = {};

  const name = text(raw, "name");
  if (!name) errors.name = "nameRequired";
  else if (name.length > 200) errors.name = "nameTooLong";

  const slug = text(raw, "slug").toLowerCase();
  if (!slug) errors.slug = "slugRequired";
  else if (!SLUG_PATTERN.test(slug)) errors.slug = "slugInvalid";

  const status = text(raw, "status") || "provisioning";
  if (!(TENANT_STATUSES as readonly string[]).includes(status)) errors.status = "statusInvalid";

  const country = text(raw, "country").toUpperCase() || "AZ";
  if (!/^[A-Z]{2}$/.test(country)) errors.country = "countryInvalid";

  const language = text(raw, "language") || "az";
  if (!(TENANT_LANGUAGES as readonly string[]).includes(language)) errors.language = "languageInvalid";

  const currency = text(raw, "currency").toUpperCase() || "AZN";
  if (!/^[A-Z]{3}$/.test(currency)) errors.currency = "currencyInvalid";

  const notes = text(raw, "notes");
  if (notes.length > 2000) errors.notes = "notesTooLong";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      slug,
      status: status as TenantStatus,
      country,
      language: language as TenantLanguage,
      currency,
      notes: notes || null,
    },
  };
}
