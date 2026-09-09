import type { VatMode } from "@/lib/finance/vatEngine";

export const TAX_PAYROLL_CONFIG_KEY = "tax_payroll_config";

export const E_QAIME_EXPORT_FORMATS = ["XML_ETAXES", "JSON_STANDARD"] as const;
export type EQaimeExportFormat = (typeof E_QAIME_EXPORT_FORMATS)[number];

export const DEFAULT_VAT_RATE_OPTIONS = ["18", "0", "exempt"] as const;
export type DefaultVatRateOption = (typeof DEFAULT_VAT_RATE_OPTIONS)[number];

export interface TaxPayrollConfig {
  company_voen: string;
  default_vat_rate: DefaultVatRateOption;
  e_qaime_export_format: EQaimeExportFormat;
  /** Employer DSMF % on the first 200 AZN band (statutory remainder stays 15%/11%). */
  dsmf_employer_rate: number;
  /** Employee DSMF % on the first 200 AZN band (remainder stays 10%). */
  dsmf_employee_rate: number;
  /** Unemployment insurance (İTŞ) % applied to both employee and employer. */
  its_rate: number;
  /** Amount of taxable income (AZN) exempt from personal income tax. */
  non_taxable_salary_limit: number;
}

export const DEFAULT_TAX_PAYROLL_CONFIG: TaxPayrollConfig = {
  company_voen: "",
  default_vat_rate: "18",
  e_qaime_export_format: "XML_ETAXES",
  dsmf_employer_rate: 22,
  dsmf_employee_rate: 3,
  its_rate: 0.5,
  non_taxable_salary_limit: 0,
};

function asNumber(value: unknown, fallback: number, min: number, max: number, decimals = 2): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.min(max, Math.max(min, n));
  const factor = 10 ** decimals;
  return Math.round(clamped * factor) / factor;
}

function asVatRate(value: unknown): DefaultVatRateOption {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "0" || raw === "0%" || raw === "zero") return "0";
  if (raw === "exempt" || raw === "none") return "exempt";
  if (raw === "18" || raw === "18%") return "18";
  return DEFAULT_TAX_PAYROLL_CONFIG.default_vat_rate;
}

function asExportFormat(value: unknown): EQaimeExportFormat {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === "JSON_STANDARD" || raw === "JSON") return "JSON_STANDARD";
  return "XML_ETAXES";
}

export function normalizeCompanyVoen(value: unknown): string {
  return String(value || "")
    .replace(/\D/g, "")
    .slice(0, 10);
}

export function parseTaxPayrollConfig(raw: unknown): TaxPayrollConfig {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    company_voen: normalizeCompanyVoen(source.company_voen),
    default_vat_rate: asVatRate(source.default_vat_rate),
    e_qaime_export_format: asExportFormat(source.e_qaime_export_format),
    dsmf_employer_rate: asNumber(source.dsmf_employer_rate, 22, 0, 50),
    dsmf_employee_rate: asNumber(source.dsmf_employee_rate, 3, 0, 50),
    its_rate: asNumber(source.its_rate, 0.5, 0, 10, 3),
    non_taxable_salary_limit: asNumber(source.non_taxable_salary_limit, 0, 0, 100000, 2),
  };
}

export function percentToRate(percent: number): number {
  return Math.max(0, Number(percent) || 0) / 100;
}

export function vatRateToNumber(rate: DefaultVatRateOption): number {
  return rate === "18" ? 18 : 0;
}

export function defaultVatMode(rate: DefaultVatRateOption): VatMode {
  return rate === "exempt" ? "none" : "exclusive";
}

export function eQaimeFormatToFile(format: EQaimeExportFormat): "xml" | "json" {
  return format === "JSON_STANDARD" ? "json" : "xml";
}
