import { type NextRequest, NextResponse } from "next/server";
import { handleOptions, jsonWithCors } from "@/lib/apiSecurity";
import { requireAuthenticatedApi } from "@/lib/auth/apiAuth";
import { clampString } from "@/lib/auth/validate";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  AI_ASSISTANT_BUCKET,
  MAX_N8N_FILE_BYTES,
  MAX_N8N_MESSAGE,
  N8N_AI_CONFIG_KEY,
  parseN8nAiConfig,
  resolveN8nRuntime,
} from "@/lib/ai/n8nConfig";
import {
  parseN8nWebhookResponse,
  sanitizeCurrentPage,
} from "@/lib/ai/n8nClient";
import { erpAgentSessionId, resolveTargetAgent } from "@/lib/ai/agents";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const N8N_TIMEOUT_MS = 50_000;
const ALLOWED_FILE_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const ALLOWED_AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/x-wav",
  "audio/webm;codecs=opus",
]);

export function OPTIONS() {
  return handleOptions();
}

async function loadRuntime() {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", N8N_AI_CONFIG_KEY)
    .maybeSingle();
  return resolveN8nRuntime(parseN8nAiConfig(data?.value));
}

export async function GET() {
  const auth = await requireAuthenticatedApi();
  if (auth.error) return auth.error;
  const runtime = await loadRuntime();
  return jsonWithCors({
    configured: Boolean(runtime?.url),
    provider: runtime?.url ? "n8n" : null,
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedApi();
  if (auth.error) return auth.error;

  const limit = rateLimit(`n8n:${auth.user.id}:${getClientIp(request)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.allowed) {
    return jsonWithCors(
      { error: "Çox sayda sorğu. Bir az gözləyin." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((limit.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  const runtime = await loadRuntime();
  if (!runtime) {
    return NextResponse.json(
      { error: "n8n webhook konfiqurasiya olunmayıb", configured: false },
      { status: 503 }
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = await buildN8nPayload(request, auth.user.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sorğu formatı yanlışdır";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const n8nResponse = await fetch(runtime.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(runtime.secret
          ? {
              Authorization: `Bearer ${runtime.secret}`,
              "X-N8N-Webhook-Token": runtime.secret,
            }
          : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(N8N_TIMEOUT_MS),
    });

    const rawText = await n8nResponse.text();
    let parsed: unknown = rawText;
    if (rawText) {
      try {
        parsed = JSON.parse(rawText) as unknown;
      } catch {
        parsed = rawText;
      }
    }

    if (!n8nResponse.ok) {
      console.warn("[n8n-bridge]", n8nResponse.status, rawText.slice(0, 240));
      return NextResponse.json({ error: "n8n webhook xətası" }, { status: 502 });
    }

    const result = parseN8nWebhookResponse(parsed);
    return NextResponse.json({
      reply: result.reply,
      buttons: result.buttons,
      table: result.table,
      links: result.links,
      provider: "n8n",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "n8n timeout";
    console.warn("[n8n-bridge]", message);
    return NextResponse.json({ error: "n8n webhook cavab vermədi" }, { status: 504 });
  }
}

function switchPayload(
  userId: string,
  targetAgent: unknown,
  content: string,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  return {
    target_agent: resolveTargetAgent(targetAgent),
    content,
    session_id: erpAgentSessionId(userId),
    ...extra,
  };
}

async function buildN8nPayload(request: NextRequest, userId: string): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const type = String(form.get("type") || "file");
    const targetAgent = form.get("target_agent");
    const currentPage = sanitizeCurrentPage(String(form.get("current_page") || "/"));
    const file = form.get("file");
    if (!(file instanceof File) || file.size <= 0) {
      throw new Error("Fayl tələb olunur");
    }
    if (file.size > MAX_N8N_FILE_BYTES) {
      throw new Error("Fayl 8 MB-dan kiçik olmalıdır");
    }
    if (type === "voice") {
      const audioBase64 = await fileToBase64(file);
      return switchPayload(userId, targetAgent, "", {
        audio_base64: audioBase64,
        file_type: file.type || "audio/webm",
        current_page: currentPage,
      });
    }
    return buildFilePayload(userId, targetAgent, currentPage, file);
  }

  const body = (await request.json()) as Record<string, unknown>;
  const type = String(body.type || "text");
  const targetAgent = body.target_agent;
  const currentPage = sanitizeCurrentPage(String(body.current_page || "/"));

  if (type === "voice") {
    const audio = clampString(String(body.audio_base64 || ""), Math.ceil(MAX_N8N_FILE_BYTES * 1.4));
    if (!audio) throw new Error("Səs faylı tələb olunur");
    return switchPayload(userId, targetAgent, "", {
      audio_base64: stripDataUrl(audio),
      current_page: currentPage,
    });
  }

  if (type === "file") {
    const fileBase64 = String(body.file_base64 || "");
    const fileType = String(body.file_type || "application/pdf");
    if (!fileBase64) throw new Error("Fayl tələb olunur");
    const buffer = Buffer.from(stripDataUrl(fileBase64), "base64");
    if (buffer.length > MAX_N8N_FILE_BYTES) throw new Error("Fayl 8 MB-dan kiçik olmalıdır");
    const fileUrl = await uploadAssistantFile(userId, buffer, fileType, "upload");
    return switchPayload(userId, targetAgent, String(body.content || ""), {
      file_url: fileUrl || "",
      file_type: fileType,
      current_page: currentPage,
      ...(fileUrl ? {} : { file_base64: stripDataUrl(fileBase64) }),
    });
  }

  const content = clampString(String(body.content || body.message || ""), MAX_N8N_MESSAGE);
  if (!content) throw new Error("Mesaj tələb olunur");
  return {
    target_agent: resolveTargetAgent(targetAgent),
    content,
    session_id: erpAgentSessionId(userId),
  };
}

async function buildFilePayload(
  userId: string,
  targetAgent: unknown,
  currentPage: string,
  file: File
): Promise<Record<string, unknown>> {
  const mime = (file.type || "").toLowerCase();
  const resolvedType = mime || guessFileType(file.name);
  if (!ALLOWED_FILE_TYPES.has(resolvedType) && !resolvedType.startsWith("image/")) {
    throw new Error("Yalnız PDF və şəkil faylları qəbul olunur");
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const fileUrl = await uploadAssistantFile(userId, buffer, resolvedType, file.name);
  const extra: Record<string, unknown> = {
    file_url: fileUrl || "",
    file_type: resolvedType,
    current_page: currentPage,
    file_name: file.name.slice(0, 120),
  };
  if (!fileUrl) {
    extra.file_base64 = buffer.toString("base64");
  }
  return switchPayload(userId, targetAgent, file.name.slice(0, 120), extra);
}

async function uploadAssistantFile(
  userId: string,
  buffer: Buffer,
  mime: string,
  originalName: string
): Promise<string | null> {
  try {
    const ext = extensionFor(mime, originalName);
    const path = `${userId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const admin = createSupabaseAdminClient();
    const { error } = await admin.storage.from(AI_ASSISTANT_BUCKET).upload(path, buffer, {
      contentType: mime || "application/octet-stream",
      upsert: false,
    });
    if (error) {
      console.warn("[n8n-bridge] storage upload", error.message);
      return null;
    }
    const signed = await admin.storage.from(AI_ASSISTANT_BUCKET).createSignedUrl(path, 3600);
    if (signed.error || !signed.data?.signedUrl) return null;
    return signed.data.signedUrl;
  } catch (err) {
    console.warn("[n8n-bridge] storage", err instanceof Error ? err.message : err);
    return null;
  }
}

async function fileToBase64(file: File): Promise<string> {
  const mime = (file.type || "").toLowerCase();
  if (mime && !isAllowedAudio(mime)) {
    throw new Error("Səs formatı dəstəklənmir");
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  return buffer.toString("base64");
}

function isAllowedAudio(mime: string): boolean {
  if (ALLOWED_AUDIO_TYPES.has(mime)) return true;
  return mime.startsWith("audio/");
}

function stripDataUrl(value: string): string {
  const match = value.match(/^data:[^;]+;base64,(.+)$/);
  return match ? match[1] : value;
}

function extensionFor(mime: string, name: string): string {
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mpeg")) return "mp3";
  if (mime.includes("wav")) return "wav";
  const fromName = name.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  return "bin";
}

function guessFileType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "application/octet-stream";
}
