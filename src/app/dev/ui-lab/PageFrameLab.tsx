"use client";

import { useI18n } from "@/i18n/I18nProvider";
import ListPageChrome from "@/components/layout/ListPageChrome";
import { GridLab, labInvoices } from "./GridLab";
import { LineGridLab } from "./LineGridLab";

/*
 * UI lab (UI-5): one page as the app builds it — a shell header, the shell's one vertical scroller
 * ([data-scroll-root]), a list page (ListPageChrome + a long DataGrid with row menus and totals)
 * and document lines (LineGrid with lookups in the cells) below. npm run ui:guard opens it at
 * /dev/ui-lab?frame=page and checks: one vertical scroll container, no empty band under the last
 * content, the grid header and actions column visible, popovers not clipped.
 */
export function PageFrameLab() {
  const { t } = useI18n();
  const l = (key: string) => t(`uiStandard.lab.${key}`);
  return (
    <div className="flex h-dvh flex-col overflow-hidden" data-ui-page-frame="">
      <header className="ds-shell-header flex h-14 shrink-0 items-center px-4 font-semibold">{l("pageFrame")}</header>
      <div data-scroll-root="" className="ds-scroll-root ds-scroll-root-tabbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-[var(--erp-content-padding-x)] py-[var(--erp-content-padding-y)] pb-24 md:pb-[var(--erp-content-padding-y)]">
        <ListPageChrome
          header={
            <div className="flex items-center justify-between gap-3 py-2">
              <h1 className="text-[length:var(--ds-text-lg)] font-semibold">{l("grid")}</h1>
            </div>
          }
          filters={<p className="ds-muted text-[length:var(--ds-text-xs)]">{l("pageFrameFilters")}</p>}
        >
          <p className="ds-muted text-[length:var(--ds-text-xs)]">{l("pageFrameHint")}</p>
          <GridLab rows={labInvoices(5)} menu />
          <section data-ui-frame="page-lines" className="flex flex-col gap-2">
            <h2 className="font-semibold">{l("lineGrid")}</h2>
            <LineGridLab />
          </section>
        </ListPageChrome>
      </div>
    </div>
  );
}
