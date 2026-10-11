import type { Messages } from "@/lib/i18n/messages";
import type { TenantFormLabels } from "./TenantForm";

export function tenantFormLabels(messages: Messages, saveLabel?: string): TenantFormLabels {
  return {
    fields: messages.tenants.fields,
    statuses: messages.tenants.statuses,
    languages: messages.languages,
    errors: messages.tenants.errors,
    save: saveLabel ?? messages.common.save,
    saving: messages.common.saving,
    saved: messages.tenants.saved,
  };
}
