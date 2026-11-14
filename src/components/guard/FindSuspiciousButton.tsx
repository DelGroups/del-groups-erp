"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button, DesignScope, ToastProvider, useToast } from "@/design-system/components";
import { useNewUi } from "@/components/shell/NewUiProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { runGuardScanAction } from "@/lib/actions/accountingGuardSection";
import { guardFindingsHref } from "@/lib/guard/findings";
import { useAccountingGuard } from "./AccountingGuardFlag";

/** What "Find suspicious documents" checks: the ledger, the documents, cash and bank, and the partners. */
export const SUSPICIOUS_SCOPE = ["ledger", "documents", "cash", "partners"] as const;

/**
 * "Find suspicious documents" on the sales and purchase lists (GUARD-3). Admins only, only with
 * ACCOUNTING_GUARD=true. It runs guard_scan over the ledger, documents, cash and partners rules and
 * opens the Findings tab of the Accounting Guard filtered to this kind of document. It reads data and
 * reports; it changes no document.
 */
export default function FindSuspiciousButton({ entity }: { entity: "sale" | "purchase" }) {
  const active = useAccountingGuard();
  const { t } = useI18n();
  const { theme } = useTheme();
  const { brand } = useNewUi();
  if (!active) return null;
  return (
    <DesignScope theme={theme === "daylight" ? "light" : "dark"} brand={brand} className="ds-scope-transparent">
      <ToastProvider closeLabel={t("common.close")}>
        <Inner entity={entity} />
      </ToastProvider>
    </DesignScope>
  );
}

function Inner({ entity }: { entity: "sale" | "purchase" }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    const result = await runGuardScanAction([...SUSPICIOUS_SCOPE], "button");
    setBusy(false);
    if (!result.success) {
      toast(t("common.error"), t(result.error), "error");
      return;
    }
    router.push(guardFindingsHref({ entity }));
  };

  return (
    <Button variant="secondary" size="sm" icon={Search} onClick={() => void run()} loading={busy} disabled={busy}>
      {busy ? t("guard.ui.findSuspiciousRunning") : t("guard.ui.findSuspicious")}
    </Button>
  );
}
