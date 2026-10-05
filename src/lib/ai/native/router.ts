/**
 * Model router for the native ERP assistant.
 *
 * Every question is sent to the cheapest model tier that can answer it well:
 *   fast     — greetings and single lookups ("how many X in stock?")
 *   standard — everyday questions that need a few tool calls
 *   deep     — analysis, comparisons, forecasts, "why" questions, long prompts
 *
 * Pure module (no "@/..." imports) so `npm test` can load it directly.
 */

export type ModelTier = "fast" | "standard" | "deep";

export const MODEL_TIERS: readonly ModelTier[] = ["fast", "standard", "deep"];

export const DEFAULT_TIER_MODELS: Record<ModelTier, string> = {
  fast: "claude-haiku-4-5",
  standard: "claude-sonnet-5-5",
  deep: "claude-opus-5-5",
};

/** USD per million tokens: [input, output]. Cache reads 0.1x input, cache writes 1.25x input. */
const MODEL_PRICES: Record<string, [number, number]> = {
  "claude-haiku-4-5": [1, 5],
  "claude-sonnet-5-5": [2, 10],
  "claude-sonnet-5": [2, 10],
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25],
};

export type RouteDecision = { tier: ModelTier; reason: string };

const DEEP_PATTERNS: RegExp[] = [
  // English
  /\b(analy[sz]e|analysis|compare|comparison|forecast|predict|trend|why|reason|strategy|recommend|optimi[sz]e|profitab|margin|explain)\b/i,
  // Azerbaijani
  /(təhlil|analiz|müqayisə|proqnoz|niyə|səbəb|tövsiyə|strategiya|rentabel|mənfəətlilik|izah et|trend)/i,
  // Russian
  /(анализ|сравн|прогноз|почему|причин|рекоменд|стратег|тренд|рентабельн|маржинальн|объясни)/i,
  // Persian
  /(تحلیل|مقایسه|پیش[‌ ]?بینی|چرا|دلیل|پیشنهاد|استراتژی|روند|سودآوری|توضیح بده)/,
];

const LOOKUP_PATTERNS: RegExp[] = [
  /\b(how many|how much|stock of|balance of|find|show|list|status of|where is)\b/i,
  /(neçə|nə qədər|qalıq|balans|tap|göstər|siyahı|status)/i,
  /(сколько|остаток|баланс|найди|покажи|список|статус)/i,
  /(چند|چقدر|موجودی|مانده|پیدا کن|نشان بده|لیست|وضعیت)/,
];

const GREETING =
  /^\s*(hi|hello|hey|thanks|thank you|salam|salamlar|təşəkkür|sağ ol|привет|здравствуйте|спасибо|سلام|مرسی|ممنون)[\s!.?]*$/i;

const LONG_MESSAGE = 600;
const SHORT_MESSAGE = 120;

export function routeRequest(message: string, options: { forceTier?: ModelTier | null } = {}): RouteDecision {
  if (options.forceTier && MODEL_TIERS.includes(options.forceTier)) {
    return { tier: options.forceTier, reason: "forced" };
  }
  const text = String(message || "").trim();
  if (!text || GREETING.test(text)) return { tier: "fast", reason: "greeting" };
  if (text.length > LONG_MESSAGE) return { tier: "deep", reason: "long_prompt" };
  if (DEEP_PATTERNS.some((pattern) => pattern.test(text))) return { tier: "deep", reason: "analysis" };
  if (text.length <= SHORT_MESSAGE && LOOKUP_PATTERNS.some((pattern) => pattern.test(text))) {
    return { tier: "fast", reason: "lookup" };
  }
  return { tier: "standard", reason: "default" };
}

function cleanEnv(value: string | undefined): string {
  return (value || "").trim().replace(/^["']|["']$/g, "");
}

/** Tier → model id; each tier can be overridden with AI_MODEL_FAST / AI_MODEL_STANDARD / AI_MODEL_DEEP. */
export function resolveTierModels(env: Record<string, string | undefined> = process.env): Record<ModelTier, string> {
  return {
    fast: cleanEnv(env.AI_MODEL_FAST) || DEFAULT_TIER_MODELS.fast,
    standard: cleanEnv(env.AI_MODEL_STANDARD) || DEFAULT_TIER_MODELS.standard,
    deep: cleanEnv(env.AI_MODEL_DEEP) || DEFAULT_TIER_MODELS.deep,
  };
}

export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
};

/** Estimated cost in USD; unknown models return null so the log never shows a wrong number. */
export function estimateCostUsd(model: string, usage: TokenUsage): number | null {
  const price = MODEL_PRICES[model];
  if (!price) return null;
  const [input, output] = price;
  const cost =
    (usage.input_tokens * input +
      usage.cache_read_tokens * input * 0.1 +
      usage.cache_write_tokens * input * 1.25 +
      usage.output_tokens * output) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
