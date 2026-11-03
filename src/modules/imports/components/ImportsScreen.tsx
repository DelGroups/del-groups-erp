"use client";

import Link from "next/link";
import { Ban, Plus, Settings2, Trash2 } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { EngineScreen, type RowActionSpec } from "@/views";
import { listShipmentsAction } from "../actions/imports";
import { importKpis, importsDefinition } from "../views/imports";
import { removalFor } from "../lib/posting";

async function fetchAll(): Promise<Record<string, unknown>[]> {
  const result = await listShipmentsAction();
  if (!result.success) throw new Error(result.error);
  return result.data;
}

const DEFINITION = importsDefinition({ fetchAll });

/** Import shipments (IMP-1, NEW_IMPORTS): list, kanban by status, pivot and graph. */
export default function ImportsScreen() {
  const { t } = useI18n();
  const { can } = useAuth();
  return (
    <EngineScreen
      definition={DEFINITION}
      title={t("imports.title")}
      kpis={(records, fmt) => importKpis(records, fmt)}
      openHref={(r) => `/imports/${r.id}`}
      // UI-5: the row "…" menu. A draft with nothing posted is deleted, anything else cancelled
      // (removalFor); the shipment page opens the confirm / reason dialog (?do=delete / ?do=cancel).
      rowActions={(r): RowActionSpec[] => {
        const removal = removalFor(r.status, r.has_prepayment);
        return [
          { key: "cancel", label: t("importPosting.cancel"), icon: <Ban className="h-4 w-4" />, destructive: true, hidden: !(removal === "cancel" && can("can_approve_imports")) },
          { key: "delete", label: t("importPosting.deleteDraft"), icon: <Trash2 className="h-4 w-4" />, destructive: true, hidden: !(removal === "delete" && can("can_manage_imports")) },
        ];
      }}
      actions={
        <div className="flex flex-wrap gap-2">
          {can("can_manage_settings") ? (
            <Link href="/settings/imports" className="ds-btn ds-btn-sm ds-btn-ghost">
              <Settings2 className="h-4 w-4" aria-hidden />
              {t("imports.settings.title")}
            </Link>
          ) : null}
          {can("can_manage_imports") ? (
            <Link href="/imports/new" className="ds-btn ds-btn-sm ds-btn-primary">
              <Plus className="h-4 w-4" aria-hidden />
              {t("imports.newShipment")}
            </Link>
          ) : null}
        </div>
      }
    />
  );
}
