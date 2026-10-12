"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";

/** On every page while the tenant is read-only (mutations are blocked in src/proxy.ts). */
export default function ReadOnlyBanner() {
  const { t } = useI18n();
  return (
    <div role="status" className="sticky top-0 z-50 bg-amber-500 px-4 py-2 text-center text-sm font-semibold text-white">
      {t("tenantStatus.readOnlyBanner")}
    </div>
  );
}
