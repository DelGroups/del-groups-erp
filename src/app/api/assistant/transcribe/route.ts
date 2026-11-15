import { type NextRequest, NextResponse } from "next/server";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { audioFileName, checkAudio, cleanTranscript, TRANSCRIBE_PROMPT, transcribeConfig } from "@/lib/assistant/transcribe";
import { assistantHistoryGate } from "../conversations/gate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RATE_LIMIT = 12;
const RATE_WINDOW_MS = 60_000;
const UPSTREAM_TIMEOUT_MS = 45_000;

/** GET: may this user's panel record voice notes? (ASSISTANT_V2 + audience, and a transcription key.) */
export async function GET() {
  const gate = await assistantHistoryGate();
  if (gate.error) return gate.error;
  return NextResponse.json({ enabled: transcribeConfig().enabled });
}

/**
 * POST multipart { audio, locale } → { text }. A short voice note from the assistant's mic becomes text
 * for the message box (the user reads it before sending). Signed in, ASSISTANT_V2 and its audience, a
 * per-user rate limit, at most 5 MB. The audio goes to OpenAI's transcription API and is not stored.
 */
export async function POST(request: NextRequest) {
  const gate = await assistantHistoryGate();
  if (gate.error) return gate.error;
  const config = transcribeConfig();
  if (!config.enabled) return NextResponse.json({ error: "Transcription is not configured" }, { status: 503 });

  const limit = rateLimit(`assistant-transcribe:${gate.userId}:${getClientIp(request)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const audio = form.get("audio");
  if (!(audio instanceof Blob)) return NextResponse.json({ error: "Audio required" }, { status: 400 });
  const check = checkAudio({ size: audio.size, type: audio.type });
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: check.status });

  const upstream = new FormData();
  upstream.set("file", new File([audio], audioFileName(check.type), { type: check.type }));
  upstream.set("model", config.model);
  // No language parameter: the model detects the spoken language (any language in, the same language out).
  upstream.set("prompt", TRANSCRIBE_PROMPT);
  upstream.set("response_format", "json");

  try {
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: upstream,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      redirect: "error",
    });
    if (!response.ok) {
      // The status only; the upstream body may echo request details.
      console.warn(`[assistant] transcription failed: HTTP ${response.status}`);
      return NextResponse.json({ error: "Transcription failed" }, { status: 502 });
    }
    const body = (await response.json().catch(() => null)) as { text?: unknown } | null;
    return NextResponse.json({ text: cleanTranscript(body?.text) });
  } catch (err) {
    console.warn(`[assistant] transcription unavailable: ${err instanceof Error ? err.name : "error"}`);
    return NextResponse.json({ error: "Transcription unavailable" }, { status: 502 });
  }
}
