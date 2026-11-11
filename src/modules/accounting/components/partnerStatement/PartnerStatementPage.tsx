"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FileCheck2, FileSpreadsheet, Printer } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import { toast } from "sonner";
import { Button, DateField, Field, LoadingState, SegmentedControl, Toolbar } from "@/design-system/components";
import { EntityLookup, LookupScope } from "@/components/lookups";
import { useI18n } from "@/i18n/I18nProvider";
import { dateFieldLabels } from "@/i18n/uiStandardLabels";
import { stateLabels } from "@/i18n/uiUnifiedLabels";
import { useCompanyProfile } from "@/hooks/useCompanyProfile";
import { isoDay } from "@/lib/home/dates";
import {
  parseStatementQuery,
  partnerTypeWhere,
  presetOf,
  presetRange,
  showSideSwitch,
  statementQueryString,
  type PartnerStatement,
  type PartnerTypeFilter,
  type StatementPreset,
  type StatementQuery,
  type StatementSide,
} from "@/lib/reports/partnerStatement";
import { fetchPartnerStatementAction, resolveStatementPartnerAction } from "../../actions/partnerStatement";
import { StatementEmpty, StatementError, StatementGrid, StatementHeaderCard, useStatementError } from "./PartnerStatementView";
import StatementPrintLayout from "./StatementPrintLayout";
import { downloadStatementXlsx, statementSheetLabels } from "./statementExport";

const PRESETS: readonly StatementPreset[] = ["thisMonth", "lastMonth", "thisYear", "allTime"];
const TYPES: readonly PartnerTypeFilter[] = ["all", "customer", "supplier", "partner"];
const SIDES: readonly StatementSide[] = ["net", "receivable", "payable"];

/**
 * "Hesab çıxarışı" (LED-3, PARTNER_LEDGERS): one partner's statement from the LED-1 ledger for a
 * period and side, with Excel and print / PDF. Every control lives in the URL
 * (?partnerId=&from=&to=&side=&type=), so the page can be linked from lists and reports.
 */
export default function PartnerStatementPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const company = useCompanyProfile();
  const errorText = useStatementError();
  const today = useMemo(() => isoDay(new Date()), []);
  const query = useMemo(() => parseStatementQuery(params, today), [params, today]);
  const [exporting, setExporting] = useState(false);

  const setQuery = useCallback(
    (patch: Partial<StatementQuery>) => {
      router.replace(`${pathname}?${statementQueryString({ ...query, ...patch })}`, { scroll: false });
    },
    [pathname, query, router]
  );

  // Customer and supplier lists link with their own id: find the partner once, then use it.
  const customerId = params.get("customerId");
  const supplierId = params.get("supplierId");
  const resolving = !query.partnerId && Boolean(customerId || supplierId);
  const resolved = useQuery({
    queryKey: ["partner-statement", "resolve", customerId, supplierId],
    enabled: resolving,
    queryFn: async () => {
      const r = await resolveStatementPartnerAction(customerId, supplierId);
      if (!r.success) throw new Error(r.error);
      return r.partnerId;
    },
  });
  useEffect(() => {
    if (resolving && resolved.data) setQuery({ partnerId: resolved.data });
  }, [resolving, resolved.data, setQuery]);

  const statement = useQuery({
    queryKey: ["partner-statement", query.partnerId, query.from, query.to, query.side],
    enabled: Boolean(query.partnerId),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const r = await fetchPartnerStatementAction(query.partnerId, query.from, query.to, query.side);
      if (!r.success) throw new Error(r.error);
      return r.data;
    },
  });
  const data: PartnerStatement | null = query.partnerId ? statement.data ?? null : null;
  const loading = statement.isFetching;
  const error = (resolving ? resolved.error : query.partnerId ? statement.error : null)?.message ?? null;
  const retry = () => void (resolving ? resolved.refetch() : statement.refetch());

  // A partner who is not both customer and supplier has one side: back to net.
  useEffect(() => {
    if (data && query.side !== "net" && !showSideSwitch(data.partner)) setQuery({ side: "net" });
  }, [data, query.side, setQuery]);

  const preset = presetOf(query.from, query.to, today);
  const dateLabels = dateFieldLabels(t);
  const states = stateLabels(t);

  const exportXlsx = async () => {
    if (!data) return;
    setExporting(true);
    try {
      await downloadStatementXlsx(data, statementSheetLabels(t, data, company.legalName));
    } catch {
      toast.error(t("partnerStatement.errors.export"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <PageLayout>
      <div className="print:hidden">
        <DocumentPageHeader
          icon={<FileCheck2 className="h-6 w-6 text-app-accent" />}
          title={t("nav.items.partnerStatement")}
          description={t("partnerStatement.description")}
          backLink={{ href: "/reports", label: t("nav.items.reports") }}
          extraActions={
            <LookupScope className="flex flex-wrap gap-2">
              <Button variant="secondary" icon={FileSpreadsheet} onClick={() => void exportXlsx()} disabled={!data || loading} loading={exporting}>
                {t("partnerStatement.exportExcel")}
              </Button>
              <Button variant="secondary" icon={Printer} onClick={() => window.print()} disabled={!data || loading}>
                {t("partnerStatement.print")}
              </Button>
            </LookupScope>
          }
        />
      </div>

      <main className="app-page-content flex-1 print:hidden">
        <LookupScope className="flex flex-col gap-4">
        <Toolbar
          label={t("partnerStatement.filters")}
          start={
            <div className="flex w-full flex-col gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <Field label={t("partnerStatement.partnerType")}>
                  {() => (
                    <SegmentedControl
                      label={t("partnerStatement.partnerType")}
                      size="sm"
                      value={query.type}
                      onValueChange={(v) => setQuery({ type: v as PartnerTypeFilter })}
                      options={TYPES.map((id) => ({ id, label: t(`partnerStatement.types.${id}`) }))}
                    />
                  )}
                </Field>
                <Field label={t("partnerStatement.partner")} className="min-w-[16rem] flex-1">
                  {({ id }) => (
                    <EntityLookup
                      id={id}
                      entity="partner"
                      value={query.partnerId || null}
                      where={partnerTypeWhere(query.type)}
                      allowCreate={false}
                      placeholder={t("partnerStatement.choosePartner")}
                      onChange={(partnerId) => setQuery({ partnerId: partnerId ?? "" })}
                    />
                  )}
                </Field>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <Field label={t("partnerStatement.period")}>
                  {() => (
                    <SegmentedControl
                      label={t("partnerStatement.period")}
                      size="sm"
                      value={preset ?? ""}
                      onValueChange={(v) => setQuery(presetRange(v as StatementPreset, today))}
                      options={PRESETS.map((id) => ({ id, label: t(`partnerStatement.presets.${id}`) }))}
                    />
                  )}
                </Field>
                <Field label={t("partnerStatement.from")}>
                  {({ id }) => (
                    <DateField
                      id={id}
                      value={query.from}
                      locale={locale}
                      labels={dateLabels}
                      onChange={(from) => setQuery({ from: from && from > query.to ? query.to : from })}
                    />
                  )}
                </Field>
                <Field label={t("partnerStatement.to")}>
                  {({ id }) => (
                    <DateField
                      id={id}
                      value={query.to}
                      locale={locale}
                      labels={dateLabels}
                      onChange={(to) => to && setQuery({ to, from: query.from && query.from > to ? to : query.from })}
                    />
                  )}
                </Field>
                {data && showSideSwitch(data.partner) ? (
                  <Field label={t("partnerStatement.side")}>
                    {() => (
                      <SegmentedControl
                        label={t("partnerStatement.side")}
                        size="sm"
                        value={query.side}
                        onValueChange={(v) => setQuery({ side: v as StatementSide })}
                        options={SIDES.map((id) => ({ id, label: t(`partnerStatement.sides.${id}`) }))}
                      />
                    )}
                  </Field>
                ) : null}
              </div>
            </div>
          }
        />

        {error ? (
          <StatementError message={errorText(error)} onRetry={retry} />
        ) : !query.partnerId ? (
          customerId || supplierId ? <LoadingState label={states.loading} rows={6} /> : <StatementEmpty />
        ) : !data ? (
          <LoadingState label={states.loading} rows={6} />
        ) : (
          <>
            <StatementHeaderCard statement={data} />
            <StatementGrid statement={data} loading={loading} gridId="partner-statement" />
          </>
        )}
        </LookupScope>
      </main>

      {data ? <StatementPrintLayout statement={data} /> : null}
    </PageLayout>
  );
}
