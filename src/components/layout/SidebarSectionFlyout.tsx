"use client";

import React, { useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavSection } from "@/lib/navigation/navConfig";
import { isItemActive, isSectionActive } from "@/lib/navigation/navConfig";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";

interface SidebarSectionFlyoutProps {
  section: NavSection;
  onNavigate?: () => void;
}

export default function SidebarSectionFlyout({ section, onNavigate }: SidebarSectionFlyoutProps) {
  const pathname = usePathname();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const SectionIcon = section.icon;
  const active = isSectionActive(pathname, section);

  return (
    <div
      ref={rootRef}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-expanded={open}
        className={cn(
          "flex w-full items-center justify-center rounded-lg px-2 py-2.5 transition-all duration-200",
          active ? "nav-link-active" : "hover:bg-[color:var(--app-card-hover)] text-[color:var(--app-sidebar-text)]"
        )}
        title={t(section.titleKey)}
      >
        <SectionIcon className="h-5 w-5 shrink-0" />
      </button>

      {open ? (
        <div
          className="absolute left-full top-0 z-50 ml-2 min-w-[13rem] rounded-lg border border-app bg-app-card p-2 shadow-xl"
          role="menu"
        >
          <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-app-muted">
            {t(section.titleKey)}
          </p>
          <div className="space-y-0.5">
            {section.items.map((item) => {
              const Icon = item.icon;
              const itemActive = isItemActive(pathname, item.path);
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors",
                    itemActive
                      ? "nav-link-active"
                      : "text-app hover:bg-app-card-hover"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{t(item.titleKey)}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
