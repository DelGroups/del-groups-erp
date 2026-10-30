"use client";

import Link from "next/link";
import { Plus, Settings2 } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { EngineScreen } from "@/views";
import { listShipmentsAction } from "../actions/imports";
import { importKpis, importsDefinition } from "../views/imports";

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
