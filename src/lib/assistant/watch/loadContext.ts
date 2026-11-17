"use server";

import { createSupabaseServerClient, getServerAuthContext } from "@/lib/supabaseServer";
import { isValidUuid } from "@/lib/auth/validate";
import { assistantAudience, isAssistantV2On } from "@/lib/assistant/config";
import { isAdminRole } from "@/types/database.types";

/**
 * loadWatchContext (AST-5): the facts of one form, read with the user's own session through
 * assistant_watch_context (which checks the create permission, and the products permission for cost).
 * Returns the raw JSON (parsed by parseWatchContext in the browser) or null when the watch is off or the
 * user may not see it, so the form simply has no warnings that need facts.
 */
export async function loadWatchContext(docType: "sale" | "purchase", partnerId: string | null, productIds: string[]): Promise<unknown | null> {
  if (!isAssistantV2On()) return null;
  if (docType !== "sale" && docType !== "purchase") return null;
  const { user, profile, isActive } = await getServerAuthContext();
  if (!user || !isActive) return null;
  if (assistantAudience() === "admins" && !isAdminRole(profile?.role)) return null;
  const ids = [...new Set((productIds ?? []).filter((id) => typeof id === "string" && isValidUuid(id)))].slice(0, 100);
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("assistant_watch_context" as never, {
    p_doc_type: docType,
    p_partner_id: partnerId && isValidUuid(partnerId) ? partnerId : null,
    p_product_ids: ids,
  } as never);
  if (error) return null;
  return data ?? null;
}

/** Open guard findings on a document the user just saved (only they, or an admin, see them). */
export async function loadSavedDocumentFindings(entityType: "sale" | "purchase", entityId: string): Promise<Array<{ rule_code: string; severity: string; doc_no: string | null }>> {
  if (!isAssistantV2On() || (entityType !== "sale" && entityType !== "purchase") || !isValidUuid(entityId)) return [];
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("assistant_my_document_findings" as never, { p_entity_type: entityType, p_entity_id: entityId } as never);
  if (error || !Array.isArray(data)) return [];
  return data as Array<{ rule_code: string; severity: string; doc_no: string | null }>;
}
