"use client";

import React from "react";
import { usePathname } from "next/navigation";
import PageLayout from "@/components/layout/PageLayout";
import PermissionGuard from "@/components/auth/PermissionGuard";
import { PageHeader } from "@/design-system/components";
import { ViewToastScope } from "@/views/components/ViewScope";
import { settingsItemForPath } from "@/lib/settings/items";
import type { PermissionKey } from "@/types/database.types";
import { useSettingsItems } from "../useSettingsItems";
import { SettingsMobileMenu, SettingsSideMenu } from "./SettingsNav";

/** True while the new Settings layout (SETTINGS_V2) is on for this user. */
export function useSettingsV2(): boolean {
  return useSettingsItems().v2;
}

/**
 * Frame of a settings page with SETTINGS_V2 (SET-1): the side menu (desktop) or the menu sheet
 * (phone), the standard page header (title and one-line description from the settings list,
 * primary action on the right) and the page's own content. The page scroller stays the shell's
 * only vertical scroller (docs/ui-standard.md "Page scroll").
 */
export function SettingsV2Page({
  id,
  actions,
  permission,
  children,
}: {
  /** Settings item id (src/lib/settings/items.ts); null for the hub. */
  id: string | null;
  actions?: React.ReactNode;
  /** Extra guard of the page, besides the route's permission. */
  permission?: PermissionKey;
  children: React.ReactNode;
}) {
  const { items } = useSettingsItems();
  const pathname = usePathname();
  const item = id ? (items.find((i) => i.id === id) ?? settingsItemForPath(items, pathname)) : null;
  const activeId = item?.id ?? null;

  const body = (
    <ViewToastScope>
      <div className="ds-settings-layout" data-settings-v2="">
        <SettingsSideMenu items={items} activeId={activeId} />
        <div className="ds-settings-main">
          <SettingsMobileMenu items={items} activeId={activeId} />
          {item ? <PageHeader title={item.title} description={item.description} actions={actions} /> : null}
          {children}
        </div>
      </div>
    </ViewToastScope>
  );

  // PageLayout guards the route's permission; a page that checks a stricter one passes it.
  return <PageLayout>{permission ? <PermissionGuard permission={permission}>{body}</PermissionGuard> : body}</PageLayout>;
}
