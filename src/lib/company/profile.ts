/**
 * Company profile: who is using this ERP. One row in public.company_profile.
 *
 * Until the company_profile migration has run, the same data is read from the
 * legacy `settings` and `company_settings` tables (profileFromLegacy), using
 * the precedence the screens used before, so nothing changes for users.
 *
 * Kept free of imports so `node --test` can load it.
 */

export const COMPANY_PROFILE_TABLE = "company_profile";
export const COMPANY_ASSET_BUCKET = "crm-assets";

export interface CompanyProfile {
  /** Name in the app header, dashboard and login page. */
  displayName: string;
  /** Registered name printed on invoices, contracts and quotations. */
  legalName: string;
  voen: string;
  address: string;
  phone: string;
  email: string;
  bankName: string;
  iban: string;
  logoUrl: string;
  sealUrl: string;
  defaultCurrency: string;
  defaultVatRate: number;
}

/** Fields only an admin may change; the rest needs can_manage_settings. */
export const ADMIN_ONLY_PROFILE_FIELDS = ["displayName", "logoUrl", "sealUrl"] as const;

export const EMPTY_COMPANY_PROFILE: CompanyProfile = {
  displayName: "",
  legalName: "",
  voen: "",
  address: "",
  phone: "",
  email: "",
  bankName: "",
  iban: "",
  logoUrl: "",
  sealUrl: "",
  defaultCurrency: "AZN",
  defaultVatRate: 18,
};

type Row = Record<string, unknown> | null | undefined;

function text(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const cleaned = text(value);
    if (cleaned) return cleaned;
  }
  return "";
}

function rate(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback;
}

function currency(value: unknown, fallback: string): string {
  const code = text(value, 10).toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : fallback;
}

/** A company_profile row (snake_case) as a CompanyProfile. */
export function profileFromRow(row: Row): CompanyProfile {
  const r = row ?? {};
  return {
    displayName: text(r.display_name, 200),
    legalName: text(r.legal_name, 200),
    voen: text(r.voen, 50),
    address: text(r.address),
    phone: text(r.phone, 50),
    email: text(r.email, 200),
    bankName: text(r.bank_name, 200),
    iban: text(r.iban, 100),
    logoUrl: text(r.logo_url, 1000),
    sealUrl: text(r.seal_url, 1000),
    defaultCurrency: currency(r.default_currency, EMPTY_COMPANY_PROFILE.defaultCurrency),
    defaultVatRate: rate(r.default_vat_rate, EMPTY_COMPANY_PROFILE.defaultVatRate),
  };
}

/** A CompanyProfile as a company_profile row (snake_case). */
export function profileToRow(profile: CompanyProfile): Record<string, string | number> {
  return {
    display_name: profile.displayName,
    legal_name: profile.legalName,
    voen: profile.voen,
    address: profile.address,
    phone: profile.phone,
    email: profile.email,
    bank_name: profile.bankName,
    iban: profile.iban,
    logo_url: profile.logoUrl,
    seal_url: profile.sealUrl,
    default_currency: profile.defaultCurrency,
    default_vat_rate: profile.defaultVatRate,
  };
}

/**
 * Same values the screens showed before company_profile existed: the header
 * used `settings`, prints preferred `company_settings`, the seal lived in the
 * CRM config. Used only while the migration has not run yet.
 */
export function profileFromLegacy(settings: Row, companySettings: Row, sealUrl?: unknown): CompanyProfile {
  const s = settings ?? {};
  const c = companySettings ?? {};
  return {
    displayName: firstText(s.company_name),
    legalName: firstText(c.company_name, s.company_name),
    voen: firstText(c.voen, s.voen),
    address: firstText(c.address, s.address),
    phone: firstText(c.phone, s.phone),
    email: firstText(c.email),
    bankName: firstText(c.bank_name),
    iban: firstText(c.iban),
    logoUrl: firstText(s.logo_url),
    sealUrl: firstText(sealUrl),
    defaultCurrency: currency(c.currency, EMPTY_COMPANY_PROFILE.defaultCurrency),
    defaultVatRate: rate(c.vat_rate, EMPTY_COMPANY_PROFILE.defaultVatRate),
  };
}

/** Name for the header and other UI; `fallback` (the product name) when unset. */
export function companyDisplayName(profile: CompanyProfile, fallback: string): string {
  return profile.displayName || profile.legalName || fallback;
}

/** Name for printed documents; `fallback` (the product name) when unset. */
export function companyLegalName(profile: CompanyProfile, fallback: string): string {
  return profile.legalName || profile.displayName || fallback;
}

/**
 * Up to two initials for the logo placeholder: first letters of the first two
 * words, ignoring a trailing legal form (MMC, LLC, ООО…).
 */
export function companyInitials(name: string): string {
  const legalForms = new Set(["MMC", "ASC", "QSC", "LLC", "LTD", "INC", "GMBH", "ООО", "ОАО", "ЗАО"]);
  const words = name
    .split(/[\s.,"«»()-]+/)
    .filter(Boolean)
    .filter((word, index, all) => !(index > 0 && index === all.length - 1 && legalForms.has(word.toUpperCase())));
  const initials = words.slice(0, 2).map((word) => Array.from(word)[0] ?? "").join("");
  return initials.toUpperCase() || "?";
}

/** Example address for e-mail inputs, on the company's own domain when known. */
export function emailPlaceholder(profile: Pick<CompanyProfile, "email">, localPart = "ad"): string {
  const domain = profile.email.split("@")[1]?.trim().toLowerCase();
  return `${localPart}@${domain && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? domain : "example.com"}`;
}

/**
 * Validates an edit to the profile. Fields an editor may not change keep their
 * current value; returns the merged profile and which fields were refused.
 */
export function mergeProfileEdit(
  current: CompanyProfile,
  input: Partial<Record<keyof CompanyProfile, unknown>>,
  { isAdmin }: { isAdmin: boolean }
): { profile: CompanyProfile; refused: (keyof CompanyProfile)[] } {
  const provided = Object.fromEntries(
    Object.entries(input).filter(([key, value]) => value !== undefined && key in current)
  ) as Partial<CompanyProfile>;
  const next = profileFromRow(profileToRow({ ...current, ...provided }));
  const refused: (keyof CompanyProfile)[] = [];
  if (!isAdmin) {
    for (const field of ADMIN_ONLY_PROFILE_FIELDS) {
      if (next[field] !== current[field]) {
        refused.push(field);
        next[field] = current[field];
      }
    }
  }
  return { profile: next, refused };
}

/** True when a Supabase/PostgREST error means the table does not exist yet. */
export function isMissingTableError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /relation .* does not exist|could not find the table/i.test(error.message ?? "");
}
