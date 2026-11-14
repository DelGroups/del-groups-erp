/**
 * Server-Sent Events of the assistant chat (AST-1): one JSON object per `data:` line. Used by the route to
 * write and by the panel (AST-2) to read, so both sides agree on the shape.
 */

export type AssistantStreamEvent =
  | { type: "start"; conversationId: string | null }
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; tool: string; summary: string }
  | { type: "tool_end"; tool: string; ok: boolean; links: Array<{ label: string; href: string }> }
  | { type: "done"; reply: string; status: string; links: Array<{ label: string; href: string }>; conversationId: string | null; skills: string[]; tier: string }
  | { type: "error"; reason: "budget" | "unavailable" | "refused"; message: string };

export function encodeSse(event: AssistantStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Splits a chunk buffer into complete events; returns the parsed events and the unfinished rest. */
export function parseSse(buffer: string): { events: AssistantStreamEvent[]; rest: string } {
  const events: AssistantStreamEvent[] = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    const line = part.split("\n").find((l) => l.startsWith("data: "));
    if (!line) continue;
    try {
      const parsed = JSON.parse(line.slice(6)) as AssistantStreamEvent;
      if (parsed && typeof parsed === "object" && typeof parsed.type === "string") events.push(parsed);
    } catch {
      // A broken line is skipped; the stream goes on.
    }
  }
  return { events, rest };
}
