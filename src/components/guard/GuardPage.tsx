"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, ShieldCheck } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import { LookupScope } from "@/components/lookups";
import { Button, Tabs, ToastProvider, useToast } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { markGuardSeenAction, runGuardScanAction } from "@/lib/actions/accountingGuardSection";
import { GUARD_TABS, guardQueryString, parseGuardQuery, type GuardQuery, type GuardTab } from "@/lib/guard/findings";
import { GUARD_KEYS } from "./guardUi";
import { useGuardAgent } from "./AccountingGuardFlag";
import GuardAskPanel from "./GuardAskPanel";
import GuardMemoryTab from "./GuardMemoryTab";
import GuardDashboardTab from "./GuardDashboardTab";
import GuardFindingsTab from "./GuardFindingsTab";
import GuardReportsTab from "./GuardReportsTab";
import GuardRulesTab from "./GuardRulesTab";
import GuardRunsTab from "./GuardRunsTab";

/**
 * The Accounting Guard section (/finance/guard, admins only, ACCOUNTING_GUARD): Dashboard,
 * Findings, Reports, Rules and Runs. Tab, filters and the open finding live in the URL, so a link
 * from a list, the bell or the home widget lands on the right view. The one primary action is
 * "Scan now". The guard only reads business data; nothing here changes a document.
 */
export default function GuardPage() {
  const { t } = useI18n();
  return (
    <PageLayout>
      <LookupScope className="flex flex-1 flex-col">
        <ToastProvider closeLabel={t("common.close")}>
          <GuardPageBody />
        </ToastProvider>
      </LookupScope>
    </PageLayout>
  );
}

function GuardPageBody() {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const q = useMemo(() => parseGuardQuery(params), [params]);
  const [scanning, setScanning] = useState(false);
  const agent = useGuardAgent();
  const g = (key: string, p?: Record<string, string | number>) => t(`guard.ui.${key}`, p);

  const setQuery = useCallback(
    (patch: Partial<GuardQuery>) => {
      const qs = guardQueryString({ ...q, ...patch });
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, q, router]
  );

  // Opening the section is "looking": the bell counts what is new after this.
  const tab = q.tab;
  useEffect(() => {
    const what = tab === "reports" ? "all" : "findings";
    void markGuardSeenAction(what).then(() => queryClient.invalidateQueries({ queryKey: GUARD_KEYS.bell }));
  }, [tab, queryClient]);

  const scanNow = async () => {
    setScanning(true);
    const result = await runGuardScanAction(null, "manual");
    setScanning(false);
    if (!result.success) {
      toast(t("common.error"), t(result.error), "error");
      return;
    }
    const { newCount, resolvedCount, failedRules } = result.data;
    toast(g("scanDone", { new: newCount, resolved: resolvedCount }), failedRules.length > 0 ? g("scanFailedRules", { rules: failedRules.join(", ") }) : undefined, failedRules.length > 0 ? "info" : "success");
    void queryClient.invalidateQueries({ queryKey: GUARD_KEYS.all });
  };

  return (
    <>
      <div className="print:hidden">
        <DocumentPageHeader
          icon={<ShieldCheck className="h-6 w-6 text-app-accent" />}
          title={t("nav.items.accountingGuard")}
          description={g("pageDescription")}
          extraActions={
            <Button variant="primary" icon={RefreshCw} onClick={() => void scanNow()} loading={scanning} disabled={scanning}>
              {g("scanNow")}
            </Button>
          }
        />
      </div>
      <main className="app-page-content flex-1 print:hidden">
        <Tabs label={g("tabsLabel")} value={q.tab} onValueChange={(v) => setQuery({ tab: v as GuardTab, finding: null })} items={GUARD_TABS.filter((id) => id !== "memory" || agent).map((id) => ({ id, label: g(`tab_${id}`) }))}>
          <div className="pt-3">
            {q.tab === "dashboard" ? <GuardDashboardTab /> : null}
            {q.tab === "findings" ? <GuardFindingsTab q={q} setQuery={setQuery} /> : null}
            {q.tab === "reports" ? (
              <>
                {agent ? <GuardAskPanel /> : null}
                <GuardReportsTab />
              </>
            ) : null}
            {q.tab === "memory" && agent ? <GuardMemoryTab /> : null}
            {q.tab === "rules" ? <GuardRulesTab /> : null}
            {q.tab === "runs" ? <GuardRunsTab /> : null}
          </div>
        </Tabs>
      </main>
    </>
  );
}
