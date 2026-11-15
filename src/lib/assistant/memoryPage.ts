/** Helpers of the admin memory page (AST-3, Settings → Assistant memory). Pure, so `npm test` checks them. */

export interface MemoryNote {
  id: string;
  scope: string;
  subject_id: string | null;
  kind: string;
  subject: string;
  body: string;
  source: string;
  confidence: number;
  evidence: Record<string, unknown> | null;
  use_count: number;
  last_used_at: string | null;
  updated_at: string;
}

export interface MemoryFilter {
  scope: string;
  kind: string;
  /** A user id: their own notes and admins' notes about them (their profile view). */
  person: string;
  search: string;
}

export function filterNotes(notes: readonly MemoryNote[], f: MemoryFilter): MemoryNote[] {
  const needle = f.search.trim().toLowerCase();
  return notes.filter(
    (n) =>
      (f.scope === "all" || n.scope === f.scope) &&
      (f.kind === "all" || n.kind === f.kind) &&
      (f.person === "all" || ((n.scope === "user" || n.scope === "employee_note") && n.subject_id === f.person)) &&
      (!needle || `${n.subject} ${n.body}`.toLowerCase().includes(needle))
  );
}

export type EvidenceKind =
  | { key: "evidenceConversation" }
  | { key: "evidenceAudit"; table: string }
  | { key: "evidenceGuard" }
  | { key: "evidenceGuardNote" }
  | { key: "evidenceAdmin" };

/** Where a note was learned from, for the edit dialog. */
export function evidenceKind(n: Pick<MemoryNote, "evidence" | "source">): EvidenceKind | null {
  const e = n.evidence ?? {};
  if (typeof e.guard_memory_id === "string") return { key: "evidenceGuardNote" };
  if (typeof e.finding_id === "string") return { key: "evidenceGuard" };
  if (e.source === "audit_logs") return { key: "evidenceAudit", table: String(e.table ?? "").replace(/_/g, " ") };
  if (typeof e.conversation_id === "string") return { key: "evidenceConversation" };
  if (n.source === "admin") return { key: "evidenceAdmin" };
  return null;
}
