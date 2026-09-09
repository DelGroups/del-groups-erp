import { clampString } from "@/lib/auth/validate";

export const N8N_AI_CONFIG_KEY = "n8n_ai_config";
export const AI_ASSISTANT_BUCKET = "ai-assistant";
export const MAX_N8N_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_N8N_MESSAGE = 4000;

export type N8nAiStoredConfig = {
  webhook_url: string;
  secret_token: string;
};

export type N8nAiPublicConfig = {
  webhook_url: string;
  secret_token: string;
  has_secret: boolean;
  env_webhook_configured: boolean;
};

function cleanEnv(value: string | undefined): string {
  return (value || "").trim().replace(/^["']|["']$/g, "");
}

export function envN8nWebhookUrl(): string {
  return cleanEnv(process.env.NEXT_PUBLIC_N8N_AI_WEBHOOK_URL) || cleanEnv(process.env.N8N_AI_WEBHOOK_URL);
}

export function envN8nWebhookSecret(): string {
  return cleanEnv(process.env.N8N_AI_WEBHOOK_SECRET);
}

export function parseN8nAiConfig(raw: unknown): N8nAiStoredConfig {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    webhook_url: clampString(String(source.webhook_url || ""), 500),
    secret_token: clampString(String(source.secret_token || ""), 200),
  };
}

export function toPublicN8nConfig(stored: N8nAiStoredConfig): N8nAiPublicConfig {
  return {
    webhook_url: stored.webhook_url,
    secret_token: "",
    has_secret: Boolean(stored.secret_token || envN8nWebhookSecret()),
    env_webhook_configured: Boolean(envN8nWebhookUrl()),
  };
}

export function isBlockedWebhookHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  if (host === "169.254.169.254" || host === "metadata.google.internal") return true;
  if (host.endsWith(".internal") && host.includes("metadata")) return true;
  return false;
}

export function validateN8nWebhookUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  const trimmed = clampString(raw, 500);
  if (!trimmed) return { ok: true, url: "" };
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { ok: false, error: "Webhook URL http və ya https olmalıdır" };
    }
    if (parsed.username || parsed.password) {
      return { ok: false, error: "Webhook URL-də istifadəçi adı/parol olmamalıdır" };
    }
    if (isBlockedWebhookHost(parsed.hostname)) {
      return { ok: false, error: "Bu webhook ünvanı icazəli deyil" };
    }
    if (parsed.protocol === "http:" && process.env.NODE_ENV === "production") {
      const host = parsed.hostname.toLowerCase();
      const local = host === "localhost" || host === "127.0.0.1";
      if (!local) return { ok: false, error: "İstehsalatda webhook HTTPS olmalıdır" };
    }
    return { ok: true, url: parsed.toString() };
  } catch {
    return { ok: false, error: "Webhook URL düzgün deyil" };
  }
}

export function resolveN8nRuntime(stored: N8nAiStoredConfig): { url: string; secret: string } | null {
  const url = stored.webhook_url || envN8nWebhookUrl();
  if (!url) return null;
  const checked = validateN8nWebhookUrl(url);
  if (!checked.ok || !checked.url) return null;
  return {
    url: checked.url,
    secret: stored.secret_token || envN8nWebhookSecret(),
  };
}
