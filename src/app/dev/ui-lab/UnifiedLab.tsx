"use client";

import { useEffect, useMemo, useState } from "react";
import { Archive, Download, FileText, Printer, Plus, ShoppingBag, ShoppingCart, Store, Trash2, Upload } from "lucide-react";
import {
  Button,
  ConfirmDialog,
  DesignScope,
  Dialog,
  Drawer,
  EmptyState,
  ErrorState,
  FormSaveBar,
  LoadingState,
  PageChromeProvider,
  PageFrame,
  PageHeader,
  SegmentedControl,
  Tabs,
  Toolbar,
  type PageChromeValue,
} from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { confirmDialogLabels, dialogLabels, saveBarLabels, stateLabels } from "@/i18n/uiUnifiedLabels";
import { UI_UNIFIED_ATTR } from "@/lib/features/uiUnified";
import { AppMenuSheet, AppSideMenu } from "@/components/shell/AppSideMenu";
import type { ShellApp } from "@/components/shell/useShell";

/*
 * UI lab (UI-7 phase 2): the unified UI's shared parts on one page as the shell builds it — the
 * app side menu (a bottom sheet below 1024 px), breadcrumbs in the PageHeader, one primary
 * action with secondaries and "…", tabs, a segmented control, the empty / error / loading states
 * and the save bar. `npm run ui:guard` opens /dev/ui-lab?frame=unified at every page size and runs
 * the page checks plus the rulebook checks (one h1 in the header, one primary button, crumbs,
 * no shell tabs, 24 px targets).
 */
export function UnifiedLab() {
  const { t } = useI18n();
  const l = (key: string) => t(`uiUnified.lab.${key}`);
  const [tab, setTab] = useState("lines");
  const [segment, setSegment] = useState("mine");
  const [dialog, setDialog] = useState<"dialog" | "drawer" | "confirm" | null>(null);

  // The unified tokens and font key off the root element, as in the shell.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute(UI_UNIFIED_ATTR, "");
    return () => root.removeAttribute(UI_UNIFIED_ATTR);
  }, []);

  const app: ShellApp = useMemo(
    () => ({
      id: "trade",
      title: t("nav.sections.trade"),
      icon: Store,
      href: "/sales",
      items: [
        { path: "/sales", title: t("nav.items.sales"), icon: ShoppingCart },
        { path: "/contracts", title: t("nav.items.contracts"), icon: FileText },
        { path: "/purchases", title: t("nav.items.purchases"), icon: ShoppingBag },
      ],
    }),
    [t]
  );
  const chrome: PageChromeValue = useMemo(
    () => ({
      crumbs: [{ label: app.title, href: "/sales" }, { label: t("nav.items.sales"), href: "/sales" }, { label: t("uiUnified.lab.record") }],
      labels: { breadcrumb: t("newShell.breadcrumb"), more: t("newShell.more"), backTo: t("uiUnified.backTo", { page: "{page}" }) },
      claimCrumbs: () => () => undefined,
    }),
    [app, t]
  );
  const states = stateLabels(t);

  return (
    <div className="flex h-dvh flex-col overflow-hidden" data-ui-frame="unified">
      <header className="ds-shell-header flex h-14 shrink-0 items-center px-4 font-semibold">{app.title}</header>
      <div data-scroll-root="" className="ds-scroll-root ds-scroll-root-tabbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-[var(--erp-content-padding-x)] py-[var(--erp-content-padding-y)] pb-24 md:pb-[var(--erp-content-padding-y)]">
        <PageChromeProvider value={chrome}>
          <DesignScope theme="light" className="ds-scope-transparent ds-app-layout">
            <AppSideMenu app={app} currentPath="/sales" />
            <div className="ds-app-main" data-side-menu="" data-shell-app={app.id}>
              <AppMenuSheet app={app} currentPath="/sales" />
              <PageFrame
                header={
                  <PageHeader
                    title={l("record")}
                    description={l("description")}
                    status={<span className="ds-chip ds-chip-flat">{l("status")}</span>}
                    primary={
                      <Button variant="primary" icon={Plus}>
                        {l("primary")}
                      </Button>
                    }
                    secondary={[
                      { id: "export", label: l("export"), icon: Download },
                      { id: "print", label: l("print"), icon: Printer },
                      { id: "import", label: l("import"), icon: Upload },
                    ]}
                    more={[
                      { id: "archive", label: l("archive"), icon: Archive },
                      { id: "delete", label: l("delete"), icon: Trash2, danger: true, onSelect: () => setDialog("confirm") },
                    ]}
                  />
                }
                toolbar={
                  <Toolbar
                    label={l("toolbar")}
                    start={<SegmentedControl label={l("segLabel")} value={segment} onValueChange={setSegment} options={[{ id: "mine", label: l("segMine") }, { id: "team", label: l("segTeam") }]} />}
                    end={
                      <>
                        <Button size="sm" onClick={() => setDialog("dialog")}>
                          {l("openDialog")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDialog("drawer")}>
                          {l("openDrawer")}
                        </Button>
                      </>
                    }
                  />
                }
                footer={<FormSaveBar dirty saving={false} onSave={() => undefined} onDiscard={() => undefined} labels={saveBarLabels(t)} />}
              >
                <Tabs
                  label={l("tabsLabel")}
                  value={tab}
                  onValueChange={setTab}
                  items={[
                    { id: "lines", label: l("tabLines"), count: 3 },
                    { id: "payments", label: l("tabPayments") },
                    { id: "history", label: l("tabHistory") },
                  ]}
                >
                  {tab === "lines" ? (
                    <LoadingState label={states.loading} rows={3} />
                  ) : tab === "payments" ? (
                    <EmptyState icon={FileText} title={l("emptyTitle")} description={l("emptyBody")} />
                  ) : (
                    <ErrorState title={states.errorTitle} description={states.errorBody} retryLabel={states.retry} onRetry={() => undefined} />
                  )}
                </Tabs>
              </PageFrame>
            </div>
          </DesignScope>
        </PageChromeProvider>
      </div>
      <Dialog open={dialog === "dialog"} onOpenChange={(o) => setDialog(o ? "dialog" : null)} title={l("dialogTitle")} description={l("description")} labels={dialogLabels(t)} footer={<Button onClick={() => setDialog(null)}>{t("uiUnified.dialog.cancel")}</Button>}>
        <p className="ds-muted">{l("emptyBody")}</p>
      </Dialog>
      <Drawer open={dialog === "drawer"} onOpenChange={(o) => setDialog(o ? "drawer" : null)} title={l("drawerTitle")} labels={dialogLabels(t)}>
        <p className="ds-muted">{l("emptyBody")}</p>
      </Drawer>
      <ConfirmDialog open={dialog === "confirm"} onOpenChange={(o) => setDialog(o ? "confirm" : null)} title={l("confirmTitle")} description={l("confirmBody")} labels={confirmDialogLabels(t, l("delete"))} onConfirm={() => undefined} />
    </div>
  );
}
