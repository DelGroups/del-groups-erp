import { formatRpcError } from "@/lib/forms/rpcErrors";

type T = Parameters<typeof formatRpcError>[1];

/** The pipeline actions answer with i18n keys (crm.pipeline.errors.*) or database messages. */
export function pipelineError(raw: string | null | undefined, t: T): string {
  if (raw && raw.startsWith("crm.pipeline.errors.")) return t(raw);
  if (raw && /belongs to another team/.test(raw)) return t("crm.pipeline.errors.otherTeam");
  if (raw && /unknown CRM stage/.test(raw)) return t("crm.pipeline.errors.stage");
  return formatRpcError(raw, t);
}
