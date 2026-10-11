"use client";

import { SaleNewPage } from "@/modules/sales/pages";
import { recordCommissionsAfterSale } from "@/modules/commissions/pages";
import { useEnabledModules } from "@/hooks/useEnabledModules";

/** The new sale screen; when commissions is enabled, a saved sale records its commissions. */
export default function SaleNewPageClient() {
  const { isEnabled } = useEnabledModules();
  return <SaleNewPage afterSaleSaved={isEnabled("commissions") ? recordCommissionsAfterSale : undefined} />;
}
