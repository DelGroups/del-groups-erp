export const CRM_CONFIG_KEY = "crm_config";

export const CRM_STAGE_KINDS = ["open", "proposal", "won", "lost"] as const;
export type CrmStageKind = (typeof CRM_STAGE_KINDS)[number];

export interface CrmPipelineStage {
  id: string;
  label: string;
  color: string;
  kind: CrmStageKind;
  locked: boolean;
}

export interface CrmConfig {
  quote_prefix: string;
  default_validity_days: number;
  terms_and_conditions: string;
  show_bank_details_on_quote: boolean;
  company_seal_signature_url: string | null;
  stages: CrmPipelineStage[];
}

export const DEFAULT_CRM_STAGES: CrmPipelineStage[] = [
  { id: "LEAD", label: "Lead", color: "#38bdf8", kind: "open", locked: false },
  { id: "QUALIFIED", label: "Qualified", color: "#818cf8", kind: "open", locked: false },
  { id: "PROPOSAL", label: "Proposal", color: "#fbbf24", kind: "proposal", locked: false },
  { id: "WON", label: "Won", color: "#34d399", kind: "won", locked: true },
  { id: "LOST", label: "Lost", color: "#fb7185", kind: "lost", locked: true },
];

export const DEFAULT_CRM_CONFIG: CrmConfig = {
  quote_prefix: "TKL-2026-",
  default_validity_days: 14,
  terms_and_conditions: "",
  show_bank_details_on_quote: true,
  company_seal_signature_url: null,
  stages: DEFAULT_CRM_STAGES,
};

const HEX_COLOR = /^#([0-9a-fA-F]{6})$/;
const STAGE_ID = /^[A-Z][A-Z0-9_]{0,31}$/;

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function asKind(value: unknown): CrmStageKind {
  return (CRM_STAGE_KINDS as readonly string[]).includes(String(value))
    ? (value as CrmStageKind)
    : "open";
}

function asColor(value: unknown, fallback: string): string {
  const raw = String(value || "").trim();
  return HEX_COLOR.test(raw) ? raw.toLowerCase() : fallback;
}

export function slugStageId(label: string, existing: string[]): string {
  const base =
    label
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32) || "STAGE";
  let id = base;
  let n = 2;
  while (existing.includes(id)) {
    const suffix = `_${n}`;
    id = `${base.slice(0, Math.max(1, 32 - suffix.length))}${suffix}`;
    n += 1;
  }
  return id;
}

export function parseCrmConfig(raw: unknown): CrmConfig {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const prefix = typeof source.quote_prefix === "string" ? source.quote_prefix.trim() : "";
  const url =
    typeof source.company_seal_signature_url === "string"
      ? source.company_seal_signature_url.trim()
      : "";

  const parsedStages = Array.isArray(source.stages)
    ? source.stages
        .map((entry, index) => {
          const row = (entry || {}) as Record<string, unknown>;
          const fallback = DEFAULT_CRM_STAGES[index] || DEFAULT_CRM_STAGES[0];
          const idRaw = String(row.id || "").trim().toUpperCase();
          const id = STAGE_ID.test(idRaw) ? idRaw : fallback.id;
          const label = String(row.label || "").trim() || fallback.label;
          const kind: CrmStageKind =
            id === "WON" ? "won" : id === "LOST" ? "lost" : asKind(row.kind);
          return {
            id,
            label: label.slice(0, 40),
            color: asColor(row.color, fallback.color),
            kind,
            locked: Boolean(row.locked) || id === "WON" || id === "LOST",
          } satisfies CrmPipelineStage;
        })
        .filter((stage, index, list) => list.findIndex((item) => item.id === stage.id) === index)
    : [];

  const stages = parsedStages.length ? parsedStages : DEFAULT_CRM_STAGES.map((stage) => ({ ...stage }));
  const hasWon = stages.some((stage) => stage.kind === "won");
  const hasLost = stages.some((stage) => stage.kind === "lost");
  if (!hasWon) {
    const won = DEFAULT_CRM_STAGES.find((stage) => stage.kind === "won")!;
    if (!stages.some((stage) => stage.id === won.id)) stages.push({ ...won });
  }
  if (!hasLost) {
    const lost = DEFAULT_CRM_STAGES.find((stage) => stage.kind === "lost")!;
    if (!stages.some((stage) => stage.id === lost.id)) stages.push({ ...lost });
  }

  return {
    quote_prefix: (prefix || DEFAULT_CRM_CONFIG.quote_prefix).slice(0, 24),
    default_validity_days: asNumber(source.default_validity_days, 14, 1, 365),
    terms_and_conditions:
      typeof source.terms_and_conditions === "string"
        ? source.terms_and_conditions.slice(0, 8000)
        : "",
    show_bank_details_on_quote: asBoolean(source.show_bank_details_on_quote, true),
    company_seal_signature_url: url || null,
    stages,
  };
}

export function defaultDealStageId(config: CrmConfig): string {
  return config.stages[0]?.id || "LEAD";
}

export function stageIdByKind(config: CrmConfig, kind: CrmStageKind): string | null {
  return config.stages.find((stage) => stage.kind === kind)?.id || null;
}

export function isKnownStageId(config: CrmConfig, stageId: string): boolean {
  return config.stages.some((stage) => stage.id === stageId);
}

export function addDaysIso(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + Math.max(1, days));
  return date.toISOString().slice(0, 10);
}
