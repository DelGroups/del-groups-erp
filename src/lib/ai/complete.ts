function cleanEnv(value: string | undefined): string {
  return (value || "").trim().replace(/^["']|["']$/g, "");
}

export type AiProviderName = "openai" | "anthropic";

export function getAiProviderConfig(): {
  provider: AiProviderName | null;
  apiKey: string;
  model: string;
} {
  const forced = cleanEnv(process.env.AI_PROVIDER).toLowerCase();
  const openaiKey = cleanEnv(process.env.OPENAI_API_KEY);
  const anthropicKey = cleanEnv(process.env.ANTHROPIC_API_KEY);
  const openaiModel = cleanEnv(process.env.OPENAI_MODEL) || "gpt-4o-mini";
  const anthropicModel = cleanEnv(process.env.ANTHROPIC_MODEL) || "claude-3-5-haiku-latest";

  if (forced === "anthropic" && anthropicKey) {
    return { provider: "anthropic", apiKey: anthropicKey, model: anthropicModel };
  }
  if (forced === "openai" && openaiKey) {
    return { provider: "openai", apiKey: openaiKey, model: openaiModel };
  }
  if (openaiKey) {
    return { provider: "openai", apiKey: openaiKey, model: openaiModel };
  }
  if (anthropicKey) {
    return { provider: "anthropic", apiKey: anthropicKey, model: anthropicModel };
  }
  return { provider: null, apiKey: "", model: "" };
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

export async function completeAssistantChat(input: {
  system: string;
  history: ChatTurn[];
  userMessage: string;
}): Promise<string> {
  const config = getAiProviderConfig();
  if (!config.provider) {
    throw new Error("AI_NOT_CONFIGURED");
  }
  if (config.provider === "anthropic") {
    return completeAnthropic(config.apiKey, config.model, input);
  }
  return completeOpenAI(config.apiKey, config.model, input);
}

async function completeOpenAI(
  apiKey: string,
  model: string,
  input: { system: string; history: ChatTurn[]; userMessage: string }
): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        { role: "system", content: input.system },
        ...input.history.map((turn) => ({ role: turn.role, content: turn.content })),
        { role: "user", content: input.userMessage },
      ],
    }),
    signal: AbortSignal.timeout(25000),
  });
  const payload = (await response.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };
  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenAI HTTP ${response.status}`);
  }
  return payload.choices?.[0]?.message?.content?.trim() || "";
}

async function completeAnthropic(
  apiKey: string,
  model: string,
  input: { system: string; history: ChatTurn[]; userMessage: string }
): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 700,
      temperature: 0.2,
      system: input.system,
      messages: [
        ...input.history.map((turn) => ({ role: turn.role, content: turn.content })),
        { role: "user", content: input.userMessage },
      ],
    }),
    signal: AbortSignal.timeout(25000),
  });
  const payload = (await response.json()) as {
    error?: { message?: string };
    content?: Array<{ type?: string; text?: string }>;
  };
  if (!response.ok) {
    throw new Error(payload.error?.message || `Anthropic HTTP ${response.status}`);
  }
  return (payload.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text || "")
    .join("\n")
    .trim();
}
