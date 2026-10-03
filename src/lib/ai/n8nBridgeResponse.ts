/**
 * Decides what the AI bridge may forward from the upstream webhook.
 *
 * Kept free of imports so `node --test` can load it directly
 * (tests/n8nBridgeResponse.test.mjs). The bridge never forwards an upstream
 * body unless it is a successful, non-HTML answer: an error page from a
 * misrouted URL (e.g. the DEL SOCIAL AI 404) must not reach the chat.
 */

export const AI_UNAVAILABLE_MESSAGE = "AI xidməti hazırda əlçatan deyil";

export type UpstreamFailureReason =
  | "redirect"
  | "http_error"
  | "html_response"
  | "timeout"
  | "network_error";

export type BridgeUpstreamResult =
  | { ok: true; parsed: unknown }
  | { ok: false; status: 502 | 504; reason: UpstreamFailureReason; upstreamStatus?: number };

export interface UpstreamResponseInput {
  status: number;
  contentType: string | null;
  body: string;
}

function looksLikeHtml(contentType: string | null, body: string): boolean {
  if (contentType && contentType.toLowerCase().includes("text/html")) return true;
  const head = body.trimStart().slice(0, 15).toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html");
}

export function interpretUpstreamResponse(input: UpstreamResponseInput): BridgeUpstreamResult {
  const { status, contentType, body } = input;

  // `fetch` runs with redirect: "manual", so a 3xx (or the opaque status 0) means
  // the webhook URL points somewhere else — never follow it.
  if (status === 0 || (status >= 300 && status < 400)) {
    return { ok: false, status: 502, reason: "redirect", upstreamStatus: status };
  }
  if (status < 200 || status >= 300) {
    return { ok: false, status: 502, reason: "http_error", upstreamStatus: status };
  }
  if (looksLikeHtml(contentType, body)) {
    return { ok: false, status: 502, reason: "html_response", upstreamStatus: status };
  }

  if (!body) return { ok: true, parsed: "" };
  try {
    return { ok: true, parsed: JSON.parse(body) as unknown };
  } catch {
    return { ok: true, parsed: body };
  }
}

export function interpretUpstreamError(err: unknown): BridgeUpstreamResult {
  const name = err && typeof err === "object" && "name" in err ? String(err.name) : "";
  if (name === "AbortError" || name === "TimeoutError") {
    return { ok: false, status: 504, reason: "timeout" };
  }
  return { ok: false, status: 502, reason: "network_error" };
}
