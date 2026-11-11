"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";
import { stateLabels } from "@/i18n/uiUnifiedLabels";
import { LoadingState, buttonClass } from "@/design-system/components";
import { LookupScope } from "@/components/lookups";
import { isoDay } from "@/lib/home/dates";
import { lastTwelveMonths, statementQueryString, type PartnerStatement } from "@/lib/reports/partnerStatement";
import { fetchPartnerStatementAction } from "../../actions/partnerStatement";
import { StatementError, StatementGrid, useStatementError } from "./PartnerStatementView";

/**
 * The partner page's Ledger tab with PARTNER_LEDGERS on: the same statement grid, the last
 * twelve months, and a link to the full statement page with this partner and range.
 */
export default function PartnerStatementPanel({ partnerId }: { partnerId: string }) {
  const { t } = useI18n();
  const errorText = useStatementError();
  const range = useMemo(() => lastTwelveMonths(isoDay(new Date())), []);
  const statement = useQuery({
    queryKey: ["partner-statement", partnerId, range.from, range.to, "net"],
    queryFn: async () => {
      const r = await fetchPartnerStatementAction(partnerId, range.from, range.to, "net");
      if (!r.success) throw new Error(r.error);
      return r.data;
    },
  });
  const data: PartnerStatement | undefined = statement.data;
  const error = statement.error?.message ?? null;

  const href = `/dashboard/reports/partner-statement?${statementQueryString({ partnerId, from: range.from, to: range.to, side: "net", type: "all" })}`;
  return (
    <LookupScope className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="ds-muted text-[length:var(--ds-text-sm)]">{t("partnerStatement.lastTwelveMonths")}</p>
        <Link href={href} className={buttonClass("secondary", "sm")}>
          {t("partnerStatement.openFull")}
        </Link>
      </div>
      {error ? (
        <StatementError message={errorText(error)} onRetry={() => void statement.refetch()} />
      ) : data ? (
        <StatementGrid statement={data} gridId="partner-detail-statement" />
      ) : (
        <LoadingState label={stateLabels(t).loading} rows={4} />
      )}
    </LookupScope>
  );
}
