"use client";

import React, { useMemo } from "react";
import { usePathname } from "next/navigation";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { buildBreadcrumbsFromPath, shouldShowGlobalBreadcrumbs } from "@/lib/navigation/breadcrumbs";
import { useI18n } from "@/i18n/I18nProvider";

export default function GlobalAppHeader() {
  const pathname = usePathname();
  const { t } = useI18n();

  const crumbs = useMemo(
    () => buildBreadcrumbsFromPath(pathname, t),
    [pathname, t]
  );

  if (!shouldShowGlobalBreadcrumbs(pathname) || crumbs.length === 0) {
    return null;
  }

  return (
    <div className="app-glass shrink-0 border-b border-app px-3 py-2.5 md:px-4 lg:px-5">
      <Breadcrumbs items={crumbs} />
    </div>
  );
}
