import type { AssistantLink } from "@/lib/ai/context";
import { isSafeInternalHref } from "@/lib/ai/links";

export type N8nDynamicButton = {
  label: string;
  href?: string;
  message?: string;
};

export type N8nDataTable = {
  headers: string[];
  rows: string[][];
};

export type N8nAssistantResult = {
  reply: string;
  buttons: N8nDynamicButton[];
  table?: N8nDataTable;
  links: AssistantLink[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function pickString(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function parseButtons(raw: unknown): N8nDynamicButton[] {
  if (!Array.isArray(raw)) return [];
  const buttons: N8nDynamicButton[] = [];
  for (const item of raw.slice(0, 12)) {
    const rec = asRecord(item);
    if (!rec) continue;
    const label = pickString(rec, ["label", "title", "text", "name"]);
    if (!label) continue;
    const hrefRaw = pickString(rec, ["href", "url", "path", "link"]);
    const message = pickString(rec, ["message", "prompt", "value"]);
    const href = hrefRaw && isSafeInternalHref(hrefRaw) ? hrefRaw : undefined;
    buttons.push({ label, href, message: message || undefined });
  }
  return buttons;
}

function parseTable(raw: unknown): N8nDataTable | undefined {
  const rec = asRecord(raw);
  if (!rec) return undefined;
  const headers = Array.isArray(rec.headers)
    ? rec.headers.map((cell) => String(cell ?? "")).slice(0, 12)
    : Array.isArray(rec.columns)
      ? rec.columns.map((cell) => String(cell ?? "")).slice(0, 12)
      : [];
  const rowsRaw = Array.isArray(rec.rows) ? rec.rows : Array.isArray(rec.data) ? rec.data : [];
  const rows = rowsRaw.slice(0, 40).map((row) => {
    if (Array.isArray(row)) return row.map((cell) => String(cell ?? "")).slice(0, 12);
    if (row && typeof row === "object") {
      const values = headers.length
        ? headers.map((header) => String((row as Record<string, unknown>)[header] ?? ""))
        : Object.values(row as Record<string, unknown>).map((cell) => String(cell ?? ""));
      return values.slice(0, 12);
    }
    return [String(row ?? "")];
  });
  if (headers.length === 0 && rows.length === 0) return undefined;
  return { headers: headers.length ? headers : rows[0]?.map((_, index) => String(index + 1)) || [], rows };
}

function unwrapPayload(payload: unknown): Record<string, unknown> | string {
  let root: unknown = payload;
  if (Array.isArray(payload) && payload.length > 0) root = payload[0];
  if (typeof root === "string") {
    const trimmed = root.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        root = JSON.parse(trimmed) as unknown;
      } catch {
        return trimmed;
      }
    } else {
      return trimmed;
    }
  }
  const rec = asRecord(root);
  if (!rec) return root == null ? "" : String(root);
  const nested = rec.json ?? rec.data ?? rec.body ?? rec.output;
  if (typeof nested === "string" && nested.trim()) {
    if (nested.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(nested) as unknown;
        const inner = asRecord(parsed);
        if (inner) return inner;
      } catch {
        return nested.trim();
      }
    }
    return nested.trim();
  }
  const nestedRec = asRecord(nested);
  return nestedRec || rec;
}

export function parseN8nWebhookResponse(payload: unknown): N8nAssistantResult {
  const unwrapped = unwrapPayload(payload);
  if (typeof unwrapped === "string") {
    return { reply: unwrapped, buttons: [], links: collectMarkdownLinks(unwrapped) };
  }

  const reply =
    pickString(unwrapped, ["reply", "markdown", "text", "output", "message", "content", "response"]) ||
    (typeof unwrapped.output === "object" ? pickString(asRecord(unwrapped.output) || {}, ["text", "markdown", "reply"]) : "");

  const buttons = parseButtons(unwrapped.buttons || unwrapped.actions || unwrapped.dynamic_buttons);
  const table = parseTable(unwrapped.table || unwrapped.data_table);
  const extraLinks = parseButtons(unwrapped.links)
    .filter((item) => item.href)
    .map((item) => ({ label: item.label, href: item.href as string }));

  const text = reply || (table ? "" : "n8n cavabı boş qayıtdı.");
  const links = [...collectMarkdownLinks(text), ...extraLinks];
  const seen = new Set<string>();
  return {
    reply: text,
    buttons,
    table,
    links: links.filter((link) => {
      const key = `${link.href}|${link.label}`;
      if (seen.has(key) || !isSafeInternalHref(link.href)) return false;
      seen.add(key);
      return true;
    }).slice(0, 16),
  };
}

export function collectMarkdownLinks(markdown: string): AssistantLink[] {
  const found: AssistantLink[] = [];
  const pattern = /\[([^\]]+)\]\((\/[a-zA-Z0-9/_-]*)\)/g;
  let match: RegExpExecArray | null = pattern.exec(markdown);
  while (match) {
    found.push({ label: match[1], href: match[2] });
    match = pattern.exec(markdown);
  }
  return found;
}

export function sanitizeSessionId(value: string): string {
  const trimmed = value.trim().slice(0, 80);
  if (/^[a-zA-Z0-9_-]{8,80}$/.test(trimmed)) return trimmed;
  return crypto.randomUUID();
}

export function sanitizeCurrentPage(value: string): string {
  const trimmed = value.trim().slice(0, 180);
  if (isSafeInternalHref(trimmed)) return trimmed;
  return "/";
}
