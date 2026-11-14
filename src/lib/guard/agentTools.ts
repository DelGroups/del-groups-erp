import type Anthropic from "@anthropic-ai/sdk";
import type { GuardDb } from "@/lib/guard/server";

/**
 * The accountant agent's tools. Read-only by construction:
 *  - it can read only the guard's own tables, a few business tables by id, and two report functions
 *    (the trial balance and a partner statement), all from an allow-list;
 *  - the only things it can write are its own notes (guard_memory_save) and a "this may not be an
 *    error" suggestion on a finding (guard_set_agent_suggestion). It has no tool to post, edit,
 *    reverse or delete an entry or a document, to change a finding's status, or to delete a note.
 * The database functions check the caller again (admin or server), so a wrong db here is still refused.
 */

export type AgentToolResult = { content: string; isError: boolean; links: Array<{ label: string; href: string }> };

/** Tables the agent may read by id, and the columns' worth of data it gets (the row as stored). */
export const AGENT_READABLE_DOCS = ["sales", "purchases", "journal_entries"] as const;
/** Functions the agent may call (name → argument names). Everything else is refused. */
export const AGENT_ALLOWED_RPC = ["get_gl_trial_balance", "get_partner_statement", "guard_memory_save", "guard_set_agent_suggestion"] as const;

const MAX_CHARS = 24_000;
const MAX_ROWS = 40;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function text(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function ok(data: unknown): AgentToolResult {
  let body = JSON.stringify(data);
  if (body.length > MAX_CHARS) body = `${body.slice(0, MAX_CHARS)}... (cut: ask for a narrower list)`;
  return { content: body, isError: false, links: [] };
}

function fail(message: string): AgentToolResult {
  return { content: message, isError: true, links: [] };
}

export const GUARD_AGENT_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "list_findings",
    description:
      "List the guard's findings, newest first (max 40). Filter by status (open, acknowledged, resolved, auto_resolved, false_positive), severity (critical, high, medium, low), rule_code (e.g. B6) or partner_id. Use it to see what is wrong now or what an admin already decided.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string" },
        severity: { type: "string" },
        rule_code: { type: "string" },
        partner_id: { type: "string" },
        limit: { type: "integer" },
      },
    },
  },
  {
    name: "get_finding",
    description: "One finding with its details and its history (who changed its status and why).",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "get_document",
    description:
      "Read one stored document by id: a sale (table sales), a purchase (purchases) or a journal entry (journal_entries). Read-only.",
    input_schema: {
      type: "object",
      properties: { table: { type: "string", enum: [...AGENT_READABLE_DOCS] }, id: { type: "string" } },
      required: ["table", "id"],
    },
  },
  {
    name: "trial_balance",
    description: "The general-ledger trial balance between two dates (YYYY-MM-DD): opening, debit, credit, closing per account.",
    input_schema: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      required: ["from", "to"],
    },
  },
  {
    name: "partner_statement",
    description: "A partner's statement of account between two dates (YYYY-MM-DD): every movement and the running balance.",
    input_schema: {
      type: "object",
      properties: { partner_id: { type: "string" }, from: { type: "string" }, to: { type: "string" } },
      required: ["partner_id", "from", "to"],
    },
  },
  {
    name: "guard_rules",
    description: "The guard's checks: code, category, default severity, whether enabled, thresholds. Use it to explain what a finding's rule looks for.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_memory",
    description: "Everything you remembered about this company before (newest first).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "remember",
    description:
      "Save one short note about this company so you know it next time: a fact (e.g. a customer buys below cost by agreement), a pattern, or the admin's preference. Same subject again updates the note. Never save secrets or personal data.",
    input_schema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "3 to 120 characters, e.g. the customer or the rule" },
        body: { type: "string", description: "3 to 2000 characters" },
        kind: { type: "string", enum: ["fact", "pattern", "preference"] },
        finding_id: { type: "string", description: "optional: the finding that taught you this" },
      },
      required: ["subject", "body"],
    },
  },
  {
    name: "suggest_false_positive",
    description:
      "Suggest that an open finding is probably not an error, with the reason (3 to 500 characters). This changes nothing: an admin confirms or dismisses the suggestion. Use it only when the evidence (the document, the ledger, the memory) really explains the finding.",
    input_schema: {
      type: "object",
      properties: { finding_id: { type: "string" }, reason: { type: "string" } },
      required: ["finding_id", "reason"],
    },
  },
];

/** Runs one tool call with the given database client (the admin's session, or the server's for scheduled runs). */
export async function runGuardAgentTool(db: GuardDb, name: string, rawInput: unknown): Promise<AgentToolResult> {
  const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
  try {
    switch (name) {
      case "list_findings": {
        let q = db.from("guard_findings").select("id, rule_code, severity, status, doc_no, doc_date, entity_type, entity_id, partner_id, amount, details, note, first_seen_at, agent_suggestion");
        const status = text(input.status, 20);
        const severity = text(input.severity, 20);
        const rule = text(input.rule_code, 10).toUpperCase();
        const partner = text(input.partner_id, 40);
        if (status) q = q.eq("status", status);
        if (severity) q = q.eq("severity", severity);
        if (rule) q = q.eq("rule_code", rule);
        if (partner) {
          if (!UUID.test(partner)) return fail("partner_id must be a uuid");
          q = q.eq("partner_id", partner);
        }
        const limit = Math.min(Math.max(Number(input.limit) || 20, 1), MAX_ROWS);
        const { data, error } = await q.order("first_seen_at", { ascending: false }).limit(limit);
        if (error) return fail(error.message);
        return ok(data);
      }
      case "get_finding": {
        const id = text(input.id, 40);
        if (!UUID.test(id)) return fail("id must be a uuid");
        const { data, error } = await db.from("guard_findings").select("*").eq("id", id).maybeSingle();
        if (error) return fail(error.message);
        const events = await db.from("guard_finding_events").select("*").eq("finding_id", id).order("created_at", { ascending: false }).limit(20);
        return ok({ finding: data, events: events.error ? [] : events.data });
      }
      case "get_document": {
        const table = text(input.table, 30);
        const id = text(input.id, 40);
        if (!(AGENT_READABLE_DOCS as readonly string[]).includes(table)) return fail("table not allowed");
        if (!UUID.test(id)) return fail("id must be a uuid");
        const { data, error } = await db.from(table).select("*").eq("id", id).maybeSingle();
        if (error) return fail(error.message);
        return ok(data);
      }
      case "trial_balance": {
        const from = text(input.from, 10);
        const to = text(input.to, 10);
        if (!DATE.test(from) || !DATE.test(to)) return fail("from and to must be YYYY-MM-DD");
        const { data, error } = await db.rpc("get_gl_trial_balance", { p_start_date: from, p_end_date: to });
        if (error) return fail(error.message);
        return ok(data);
      }
      case "partner_statement": {
        const partner = text(input.partner_id, 40);
        const from = text(input.from, 10);
        const to = text(input.to, 10);
        if (!UUID.test(partner)) return fail("partner_id must be a uuid");
        if (!DATE.test(from) || !DATE.test(to)) return fail("from and to must be YYYY-MM-DD");
        const { data, error } = await db.rpc("get_partner_statement", { p_partner_id: partner, p_from: from, p_to: to, p_side: "net" });
        if (error) return fail(error.message);
        return ok(data);
      }
      case "guard_rules": {
        const { data, error } = await db.from("guard_rules").select("code, category, default_severity, enabled, params, description_key");
        if (error) return fail(error.message);
        return ok(data);
      }
      case "list_memory": {
        const { data, error } = await db.from("guard_agent_memory").select("id, kind, subject, body, source, updated_at").order("updated_at", { ascending: false }).limit(200);
        if (error) return fail(error.message);
        return ok(data);
      }
      case "remember": {
        const kind = ["fact", "pattern", "preference"].includes(text(input.kind, 12)) ? text(input.kind, 12) : "fact";
        const ref = text(input.finding_id, 40);
        const { data, error } = await db.rpc("guard_memory_save", {
          p_subject: text(input.subject, 120),
          p_body: text(input.body, 2000),
          p_kind: kind,
          p_source: "agent",
          p_source_ref: UUID.test(ref) ? ref : null,
        });
        if (error) return fail(error.message);
        return ok({ saved: true, id: data });
      }
      case "suggest_false_positive": {
        const id = text(input.finding_id, 40);
        if (!UUID.test(id)) return fail("finding_id must be a uuid");
        const { data, error } = await db.rpc("guard_set_agent_suggestion", {
          p_id: id,
          p_suggestion: { status: "false_positive", reason: text(input.reason, 500) },
        });
        if (error) return fail(error.message);
        return ok({ suggested: data === true, note: "An admin must confirm. Nothing was changed." });
      }
      default:
        return fail(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Tool failed");
  }
}
