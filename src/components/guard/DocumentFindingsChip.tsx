"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/i18n/I18nProvider";
import { guardFindingsForDocumentsAction } from "@/lib/actions/accountingGuardSection";
import { guardFindingsHref } from "@/lib/guard/findings";
import { useAccountingGuard } from "./AccountingGuardFlag";

/**
 * A small warning chip in the sale and purchase view (GUARD-3): shown to admins, with ACCOUNTING_GUARD
 * on, when the Accounting Guard has open findings for this document. It opens them (the Findings tab
 * filtered to this kind of document and number). It reads only.
 */
export default function DocumentFindingsChip({ entity, id, docNo }: { entity: "sale" | "purchase"; id: string; docNo?: string | null }) {
  const active = useAccountingGuard();
  const { t } = useI18n();
  const found = useQuery({
    queryKey: ["guard", "document", entity, id],
    enabled: active && !!id,
    staleTime: 60_000,
    queryFn: async () => {
      const r = await guardFindingsForDocumentsAction(entity, [id]);
      return r.success ? (r.data.byDocument[id] ?? null) : null;
    },
  });
  if (!active || !found.data) return null;
  const text = t("guard.ui.chipFindings", { count: found.data.count });
  return (
    <Link href={guardFindingsHref({ entity, search: docNo ?? "" })} title={t("guard.ui.chipOpen")} className="inline-flex">
      <Badge variant={found.data.severity === "critical" || found.data.severity === "high" ? "danger" : "warning"}>
        <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
        {text}
      </Badge>
    </Link>
  );
}
