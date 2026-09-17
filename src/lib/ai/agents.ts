export const DEFAULT_ERP_AGENT = "Del";

/**
 * Must match the n8n agent workflow keys exactly (same ids as
 * ai-agent-control-panel's lib/agents.ts AGENTS list) — n8n routes on this
 * value, not on the display label.
 */
export type ErpAiAgentId =
  | "Del"
  | "Leyla"
  | "Ayda"
  | "Kamran"
  | "Nigar"
  | "Araz"
  | "Sona";

export type ErpAiAgent = {
  id: ErpAiAgentId;
  emoji: string;
  label: string;
  role: string;
  isDefault?: boolean;
};

export const ERP_AI_AGENTS: readonly ErpAiAgent[] = [
  {
    id: "Del",
    emoji: "🤖",
    label: "Del",
    role: "Del Groups ERP Əməliyyat və Maliyyə Köməkçisi",
    isDefault: true,
  },
  {
    id: "Leyla",
    emoji: "👑",
    label: "Leyla Balayeva",
    role: "Orchestrator",
  },
  {
    id: "Ayda",
    emoji: "🛋️",
    label: "Ayda",
    role: "Müştəri Xidmətləri & Qəbul",
  },
  {
    id: "Kamran",
    emoji: "📐",
    label: "Kamran Qasımov",
    role: "Mühəndis & Qıymət",
  },
  {
    id: "Nigar",
    emoji: "📈",
    label: "Nigar Məmmədova",
    role: "Marketing Strategiyası",
  },
  {
    id: "Araz",
    emoji: "🔍",
    label: "Araz Əliyev",
    role: "Bazar Araşdırması",
  },
  {
    id: "Sona",
    emoji: "🎨",
    label: "Sona Rəhimli",
    role: "Kreativ Məzmun",
  },
] as const;

const AGENT_IDS = new Set<string>(ERP_AI_AGENTS.map((agent) => agent.id));

export function resolveTargetAgent(value: unknown): ErpAiAgentId {
  const name = String(value || "").trim();
  if (AGENT_IDS.has(name)) return name as ErpAiAgentId;
  return DEFAULT_ERP_AGENT;
}

export function erpAgentSessionId(userId: string): string {
  const id = String(userId || "").trim() || "anonymous";
  return `${id}_erp_session`;
}

export function formatAgentOption(agent: ErpAiAgent): string {
  const defaultMark = agent.isDefault ? " [DEFAULT]" : "";
  return `${agent.emoji} ${agent.label} (${agent.role})${defaultMark}`;
}
