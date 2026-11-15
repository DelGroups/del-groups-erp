/**
 * Speech to text for the assistant's mic (Del, 2026-11-15): the browser's own speech service does not
 * understand Azerbaijani, so the panel records a short voice note and the server turns it into text with
 * OpenAI's transcription model. The audio is sent only for that and is never stored.
 *
 *   OPENAI_TRANSCRIBE_API_KEY      the OpenAI key for transcription (server only). Its own name, so the old
 *                                  widget's chat (which picks OPENAI_API_KEY first) keeps using Claude.
 *   ASSISTANT_TRANSCRIBE_MODEL     optional, default gpt-4o-mini-transcribe
 *
 * Pure functions of an env object, so tests pass their own.
 */

type Env = Readonly<Record<string, string | undefined>>;

function clean(value: string | undefined): string {
  return (value ?? "").trim().replace(/^["']|["']$/g, "");
}

export const DEFAULT_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";
/** About a minute of compressed speech; the panel stops recording at 60 s. */
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
export const MIN_AUDIO_BYTES = 1000;
export const MAX_RECORDING_MS = 60_000;

export type TranscribeConfig = { enabled: true; apiKey: string; model: string } | { enabled: false };

export function transcribeConfig(env: Env = process.env): TranscribeConfig {
  const apiKey = clean(env.OPENAI_TRANSCRIBE_API_KEY);
  if (!apiKey) return { enabled: false };
  return { enabled: true, apiKey, model: clean(env.ASSISTANT_TRANSCRIBE_MODEL) || DEFAULT_TRANSCRIBE_MODEL };
}

const TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-m4a", "audio/aac"];

/** "audio/webm;codecs=opus" → "audio/webm"; null when it is not an audio type we send on. */
export function audioType(mime: string | null | undefined): string | null {
  const base = (mime ?? "").split(";")[0].trim().toLowerCase();
  return TYPES.includes(base) ? base : null;
}

/** A file name with the right extension (the transcription API reads the format from it). */
export function audioFileName(type: string): string {
  const ext: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-m4a": "m4a", "audio/aac": "aac" };
  return `voice.${ext[type] ?? "webm"}`;
}

export type AudioCheck = { ok: true; type: string } | { ok: false; status: 400 | 413 | 415; reason: "empty" | "too_large" | "type" };

export function checkAudio(input: { size: number; type: string | null | undefined }): AudioCheck {
  if (!Number.isFinite(input.size) || input.size < MIN_AUDIO_BYTES) return { ok: false, status: 400, reason: "empty" };
  if (input.size > MAX_AUDIO_BYTES) return { ok: false, status: 413, reason: "too_large" };
  const type = audioType(input.type);
  return type ? { ok: true, type } : { ok: false, status: 415, reason: "type" };
}

/** The ERP language as the language hint of the transcription (better accuracy for short notes). */
export function transcribeLanguage(locale: unknown): "az" | "en" | "ru" {
  return locale === "en" || locale === "ru" ? locale : "az";
}

/** One line of plain text for the message box. */
export function cleanTranscript(text: unknown): string {
  return typeof text === "string" ? text.replace(/\s+/g, " ").trim().slice(0, 4000) : "";
}
