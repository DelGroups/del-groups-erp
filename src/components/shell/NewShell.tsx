"use client";

import React, { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  FilePlus,
  Grid3X3,
  Languages,
  LayoutGrid,
  LogOut,
  Menu,
  Moon,
  MoreHorizontal,
  Plus,
  Receipt,
  Search,
  Settings,
  Sparkles,
  Sun,
  UserPlus,
  X,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useCompanyProfile } from "@/hooks/useCompanyProfile";
import { useEnabledModules } from "@/hooks/useEnabledModules";
import { useI18n } from "@/i18n/I18nProvider";
import { LOCALES, LOCALE_LABELS } from "@/i18n/types";
import { useTheme } from "@/theme/ThemeProvider";
import { useLimitStatus } from "@/components/limits/useLimitStatus";
import { formatBytesShort, limitState, type LimitKind } from "@/lib/limits/limits";
import { CommandPalette, DesignScope, useDesignScope, type PaletteAction } from "@/design-system/components";
import type { PaletteGroup } from "@/design-system/logic";
import { motionPreset, overlayVariants, transitions } from "@/design-system/motion";
import { AI_OPEN_EVENT, collapseCrumbs, filterApps, shellBackButton, shortcutModifier, type Crumb } from "@/lib/shell/shell";
import { useNewUi } from "./NewUiProvider";
import { markShellNavigation, useBreadcrumbTrail, useShellApps, type ShellApp } from "./useShell";
import { ShellBackButton } from "./ShellBackButton";

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

const noopSubscribe = () => () => undefined;
function useModifierKey(): "⌘" | "Ctrl" {
  return useSyncExternalStore(noopSubscribe, () => shortcutModifier(navigator.platform), () => "Ctrl");
}

/** A link of the shell's own navigation: the next page starts a new breadcrumb trail. */
function ShellLink({ href, className, children, onNavigate, ...rest }: React.ComponentProps<typeof Link> & { href: string; onNavigate?: () => void }) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        markShellNavigation();
        onNavigate?.();
      }}
      {...rest}
    >
      {children}
    </Link>
  );
}

// ── Launcher (popover and the /apps page) ────────────────────────────────────

export function AppGrid({ apps, query, onOpen, renderExtra }: { apps: ShellApp[]; query: string; onOpen?: () => void; renderExtra?: (app: ShellApp) => React.ReactNode }) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const shown = filterApps(
    apps.map((a) => ({ ...a, itemTitles: a.items.map((i) => i.title) })),
    query
  );
  if (!shown.length) return <p className="px-2 py-6 text-center ds-muted">{t("newShell.noApps")}</p>;
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {shown.map((app) => {
        const Icon = app.icon;
        return (
          <motion.li key={app.id} whileHover={reduced ? undefined : { y: -2 }} transition={transitions.fast}>
            <ShellLink
              href={app.href}
              onNavigate={onOpen}
              className="flex h-full flex-col gap-2 p-3 no-underline outline-none transition-colors focus-visible:shadow-[var(--ds-focus-ring)]"
              style={{ borderRadius: "var(--ds-radius-lg)", border: "1px solid var(--ds-border)", background: "var(--ds-surface)", color: "var(--ds-text)" }}
            >
              <span className="grid h-10 w-10 place-items-center" style={{ borderRadius: "var(--ds-radius-md)", background: "var(--ds-brand-soft)", color: "var(--ds-brand)" }} aria-hidden>
                <Icon className="h-5 w-5" />
              </span>
              <span className="font-semibold">{app.title}</span>
              <span className="line-clamp-2 text-[length:var(--ds-text-xs)] ds-muted">{app.items.map((i) => i.title).join(" · ")}</span>
              {renderExtra?.(app)}
            </ShellLink>
          </motion.li>
        );
      })}
    </ul>
  );
}

function LauncherPopover({ apps }: { apps: ShellApp[] }) {
  const { t } = useI18n();
  const { portalContainer } = useDesignScope();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <Popover.Trigger className="ds-icon-btn" aria-label={t("newShell.launcher")}>
        <Grid3X3 className="h-5 w-5" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal container={portalContainer ?? undefined}>
        <Popover.Content align="start" sideOffset={8} className="ds-menu w-[min(34rem,calc(100vw-1.5rem))] p-3">
          <label className="mb-3 flex items-center gap-2 px-1">
            <Search className="h-4 w-4 ds-muted" aria-hidden />
            <input className="ds-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("newShell.searchApps")} aria-label={t("newShell.searchApps")} autoFocus />
          </label>
          <AppGrid apps={apps} query={query} onOpen={() => setOpen(false)} />
          <div className="mt-3 flex items-center justify-between border-t px-1 pt-3 text-[length:var(--ds-text-xs)]" style={{ borderColor: "var(--ds-border)" }}>
            <ShellLink href="/apps" onNavigate={() => setOpen(false)} className="ds-muted underline">
              {t("newShell.allApps")}
            </ShellLink>
            {apps.some((a) => a.items.some((i) => i.path === "/settings")) ? (
              <ShellLink href="/settings" onNavigate={() => setOpen(false)} className="flex items-center gap-1 ds-muted underline">
                <Settings className="h-3.5 w-3.5" aria-hidden /> {t("newShell.administration")}
              </ShellLink>
            ) : null}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ── Workspace (company) switcher ─────────────────────────────────────────────

function WorkspaceSwitcher() {
  const { t } = useI18n();
  const { portalContainer } = useDesignScope();
  const company = useCompanyProfile();
  const { roleName } = useAuth();
  const name = company.displayName;
  const logo = company.profile.logoUrl;
  const avatar = logo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logo} alt="" className="h-7 w-7 rounded-[var(--ds-radius-sm)] object-cover" />
  ) : (
    <span className="grid h-7 w-7 place-items-center rounded-[var(--ds-radius-sm)] text-[length:var(--ds-text-xs)] font-semibold" style={{ background: "var(--ds-brand)", color: "var(--ds-brand-fg)" }}>
      {initials(name)}
    </span>
  );
  return (
    <Dropdown.Root>
      <Dropdown.Trigger className="ds-btn ds-btn-ghost max-w-[16rem] gap-2 px-1.5" aria-label={t("newShell.workspace")}>
        {avatar}
        <span className="hidden min-w-0 flex-col items-start leading-tight lg:flex">
          <span className="max-w-[10rem] truncate font-semibold">{name}</span>
          <span className="text-[length:var(--ds-text-xs)] ds-muted">{roleName}</span>
        </span>
        <ChevronDown className="h-4 w-4 ds-muted" aria-hidden />
      </Dropdown.Trigger>
      <Dropdown.Portal container={portalContainer ?? undefined}>
        <Dropdown.Content align="start" sideOffset={8} className="ds-menu max-w-xs">
          <Dropdown.Label className="px-2.5 pb-1 pt-1.5 ds-label">{t("newShell.workspace")}</Dropdown.Label>
          <Dropdown.Item className="ds-menu-item" onSelect={(e) => e.preventDefault()}>
            {avatar}
            <span className="min-w-0 flex-1 truncate">{name}</span>
            <Check className="h-4 w-4" style={{ color: "var(--ds-brand)" }} aria-label={t("newShell.currentCompany")} />
          </Dropdown.Item>
          <Dropdown.Separator className="ds-menu-sep" />
          <Dropdown.Item asChild className="ds-menu-item">
            <ShellLink href="/settings">
              <Settings className="h-4 w-4" aria-hidden /> {t("newShell.companySettings")}
            </ShellLink>
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

// ── Notifications (plan limits for now) ──────────────────────────────────────

const LIMIT_TEXT: Record<LimitKind, { warning: string; blocked: string }> = {
  users: { warning: "limits.bannerUsersWarning", blocked: "limits.bannerUsersBlocked" },
  storage: { warning: "limits.bannerStorageWarning", blocked: "limits.bannerStorageBlocked" },
  ai: { warning: "limits.bannerAiWarning", blocked: "limits.bannerAiBlocked" },
};

function useNotifications(): string[] {
  const { t } = useI18n();
  const { user, can } = useAuth();
  const { status } = useLimitStatus(Boolean(user));
  return useMemo(() => {
    if (!status) return [];
    const out: string[] = [];
    for (const kind of ["users", "storage", "ai"] as const) {
      if (kind === "users" && !can("can_manage_users")) continue;
      const u = status[kind];
      const state = limitState(u);
      if (state !== "warning" && state !== "blocked") continue;
      const fmt = (v: number | null) => (v === null ? "∞" : kind === "storage" ? formatBytesShort(v) : kind === "ai" ? v.toFixed(2) : String(v));
      out.push(t(LIMIT_TEXT[kind][state], { used: fmt(u.used), limit: fmt(u.limit) }));
    }
    return out;
  }, [status, can, t]);
}

function NotificationsButton({ items, tab = false }: { items: string[]; /** Bottom tab bar look (glyph over a tiny label). */ tab?: boolean }) {
  const { t } = useI18n();
  const { portalContainer } = useDesignScope();
  const label = items.length ? t("newShell.notificationsUnread", { count: items.length }) : t("newShell.notifications");
  return (
    <Popover.Root>
      {tab ? (
        <Popover.Trigger className="relative flex w-full flex-col items-center gap-0.5 text-[10px] ds-muted" aria-label={label}>
          <span className="relative">
            <Bell className="h-5 w-5" aria-hidden />
            {items.length ? <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full" style={{ background: "var(--ds-danger-strong)" }} aria-hidden /> : null}
          </span>
          {t("newShell.notifications")}
        </Popover.Trigger>
      ) : (
        <Popover.Trigger className="ds-icon-btn" aria-label={label}>
          <Bell className="h-5 w-5" aria-hidden />
          {items.length ? <span className="ds-dot" aria-hidden /> : null}
        </Popover.Trigger>
      )}
      <Popover.Portal container={portalContainer ?? undefined}>
        <Popover.Content align="end" sideOffset={8} className="ds-menu w-80 p-2">
          <p className="px-2 pb-2 pt-1 font-semibold">{t("newShell.notifications")}</p>
          {items.length ? (
            <ul className="flex flex-col gap-1">
              {items.map((text) => (
                <li key={text} className="rounded-[var(--ds-radius-sm)] p-2.5" style={{ background: "var(--ds-warning-soft)" }}>
                  {text}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-4 text-center ds-muted">{t("newShell.noNotifications")}</p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ── Quick actions and user menu ──────────────────────────────────────────────

function useQuickActions() {
  const { t } = useI18n();
  const { isEnabled } = useEnabledModules();
  return [
    isEnabled("sales") ? { id: "invoice", label: t("shell.createInvoice"), href: "/sales/new", icon: FilePlus } : null,
    { id: "customer", label: t("shell.addCustomer"), href: "/customers", icon: UserPlus },
    isEnabled("expenses") ? { id: "expense", label: t("shell.addExpense"), href: "/expenses", icon: Receipt } : null,
  ].filter((a): a is { id: string; label: string; href: string; icon: typeof FilePlus } => a !== null);
}

function QuickActions({ trigger }: { trigger: React.ReactNode }) {
  const { t } = useI18n();
  const { portalContainer } = useDesignScope();
  const actions = useQuickActions();
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger>
      <Dropdown.Portal container={portalContainer ?? undefined}>
        <Dropdown.Content align="end" sideOffset={8} className="ds-menu">
          <Dropdown.Label className="px-2.5 pb-1 pt-1.5 ds-label">{t("shell.quickActions")}</Dropdown.Label>
          {actions.map((a) => (
            <Dropdown.Item key={a.id} asChild className="ds-menu-item">
              <ShellLink href={a.href}>
                <a.icon className="h-4 w-4" aria-hidden /> {a.label}
              </ShellLink>
            </Dropdown.Item>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

function UserMenu() {
  const { t, locale, setLocale } = useI18n();
  const { displayName, roleName, email, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const { canToggle, setPreferred } = useNewUi();
  const { portalContainer } = useDesignScope();
  const dark = theme !== "daylight";
  return (
    <Dropdown.Root>
      <Dropdown.Trigger className="ds-btn ds-btn-ghost gap-2 px-1.5" aria-label={t("newShell.userMenu")}>
        <span className="grid h-8 w-8 place-items-center rounded-full text-[length:var(--ds-text-xs)] font-semibold" style={{ background: "var(--ds-surface-sunken)", border: "1px solid var(--ds-border)" }}>
          {initials(displayName)}
        </span>
      </Dropdown.Trigger>
      <Dropdown.Portal container={portalContainer ?? undefined}>
        <Dropdown.Content align="end" sideOffset={8} className="ds-menu w-64">
          <div className="px-2.5 py-2">
            <p className="truncate font-semibold">{displayName}</p>
            <p className="truncate text-[length:var(--ds-text-xs)] ds-muted">{email || roleName}</p>
          </div>
          <Dropdown.Separator className="ds-menu-sep" />
          <Dropdown.Label className="flex items-center gap-2 px-2.5 pb-1 pt-1.5 ds-label">
            <Languages className="h-3.5 w-3.5" aria-hidden /> {t("newShell.language")}
          </Dropdown.Label>
          <Dropdown.RadioGroup value={locale} onValueChange={(v) => void setLocale(v as (typeof LOCALES)[number])}>
            {LOCALES.map((l) => (
              <Dropdown.RadioItem key={l} value={l} className="ds-menu-item">
                <span className="w-4">{l === locale ? <Check className="h-4 w-4" aria-hidden /> : null}</span>
                {LOCALE_LABELS[l]}
              </Dropdown.RadioItem>
            ))}
          </Dropdown.RadioGroup>
          <Dropdown.Separator className="ds-menu-sep" />
          <Dropdown.Item className="ds-menu-item" onSelect={() => setTheme(dark ? "daylight" : "graphite")}>
            {dark ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
            {dark ? t("newShell.themeLight") : t("newShell.themeDark")}
          </Dropdown.Item>
          {canToggle ? (
            <Dropdown.Item className="ds-menu-item" onSelect={() => setPreferred(false)}>
              <LayoutGrid className="h-4 w-4" aria-hidden /> {t("newShell.classic")}
            </Dropdown.Item>
          ) : null}
          <Dropdown.Separator className="ds-menu-sep" />
          <Dropdown.Item className="ds-menu-item" onSelect={() => void signOut()}>
            <LogOut className="h-4 w-4" aria-hidden /> {t("newShell.signOut")}
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

// ── Breadcrumbs ──────────────────────────────────────────────────────────────

function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  const { t } = useI18n();
  const { portalContainer } = useDesignScope();
  const { visible, hidden, collapsedAt } = collapseCrumbs(crumbs);
  if (crumbs.length === 0) return null;
  const crumbEl = (c: Crumb, last: boolean) =>
    c.href && !last ? (
      <Link href={c.href} className="truncate ds-muted hover:underline">
        {c.label}
      </Link>
    ) : (
      <span className="truncate font-medium" aria-current={last ? "page" : undefined}>
        {c.label}
      </span>
    );
  return (
    <nav aria-label={t("newShell.breadcrumb")} className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-[length:var(--ds-text-sm)]">
        {visible.map((c, i) => (
          <React.Fragment key={`${c.href ?? ""}:${c.label}:${i}`}>
            {i > 0 ? <ChevronRight className="h-3.5 w-3.5 shrink-0 ds-subtle" aria-hidden /> : null}
            {collapsedAt === i ? (
              <>
                <li>
                  <Popover.Root>
                    <Popover.Trigger className="ds-icon-btn h-6 w-6" aria-label={t("newShell.more")}>
                      <MoreHorizontal className="h-4 w-4" aria-hidden />
                    </Popover.Trigger>
                    <Popover.Portal container={portalContainer ?? undefined}>
                      <Popover.Content align="start" sideOffset={6} className="ds-menu">
                        {hidden.map((h) =>
                          h.href ? (
                            <Link key={h.href} href={h.href} className="ds-menu-item">
                              {h.label}
                            </Link>
                          ) : (
                            <span key={h.label} className="ds-menu-item">
                              {h.label}
                            </span>
                          )
                        )}
                      </Popover.Content>
                    </Popover.Portal>
                  </Popover.Root>
                </li>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 ds-subtle" aria-hidden />
              </>
            ) : null}
            <li className="flex min-w-0 items-center">{crumbEl(c, i === visible.length - 1)}</li>
          </React.Fragment>
        ))}
      </ol>
    </nav>
  );
}

// ── Mobile drawer ────────────────────────────────────────────────────────────

function MobileDrawer({ open, onOpenChange, apps, current, currentItemPath }: { open: boolean; onOpenChange: (open: boolean) => void; apps: ShellApp[]; current: ShellApp | null; currentItemPath: string | null }) {
  const { t } = useI18n();
  const { portalContainer } = useDesignScope();
  const reduced = useReducedMotion();
  const company = useCompanyProfile();
  const [expanded, setExpanded] = useState<string | null>(current?.id ?? null);
  const close = () => onOpenChange(false);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <Dialog.Portal forceMount container={portalContainer ?? undefined}>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="ds-overlay" variants={motionPreset(overlayVariants, reduced)} initial="initial" animate="enter" exit="exit" />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="fixed inset-y-0 right-0 z-[61] flex w-[80%] max-w-xs flex-col"
                style={{ background: "var(--ds-surface)", boxShadow: "var(--ds-elevation-4)" }}
                initial={reduced ? { opacity: 0 } : { x: "100%" }}
                animate={reduced ? { opacity: 1 } : { x: 0 }}
                exit={reduced ? { opacity: 0 } : { x: "100%" }}
                transition={reduced ? transitions.instant : transitions.base}
              >
                <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--ds-border)" }}>
                  <Dialog.Title className="truncate font-semibold">{company.displayName}</Dialog.Title>
                  <Dialog.Close className="ds-icon-btn" aria-label={t("newShell.close")} autoFocus>
                    <X className="h-5 w-5" aria-hidden />
                  </Dialog.Close>
                </div>
                <nav aria-label={t("newShell.apps")} className="flex-1 overflow-y-auto p-2">
                  <ShellLink href="/apps" onNavigate={close} className="ds-menu-item text-[length:var(--ds-text-base)]">
                    <LayoutGrid className="h-5 w-5" aria-hidden /> {t("newShell.allApps")}
                  </ShellLink>
                  <div className="ds-menu-sep" />
                  <ul>
                    {apps.map((app) => {
                      const Icon = app.icon;
                      const isOpen = expanded === app.id;
                      return (
                        <li key={app.id} className="border-b last:border-0" style={{ borderColor: "var(--ds-border)" }}>
                          <button type="button" className="ds-menu-item w-full justify-between text-[length:var(--ds-text-base)]" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : app.id)}>
                            <span className="flex items-center gap-3">
                              <Icon className="h-5 w-5" aria-hidden /> {app.title}
                            </span>
                            <ChevronDown className="h-4 w-4 transition-transform" style={{ transform: isOpen ? "rotate(180deg)" : undefined }} aria-hidden />
                          </button>
                          {isOpen ? (
                            <ul className="pb-2 pl-8">
                              {app.items.map((item) => (
                                <li key={item.path}>
                                  <ShellLink href={item.path} onNavigate={close} className="ds-menu-item" aria-current={item.path === currentItemPath ? "page" : undefined}>
                                    {item.title}
                                  </ShellLink>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </nav>
                <DrawerFooter onDone={close} />
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}

function DrawerFooter({ onDone }: { onDone: () => void }) {
  const { t, locale, setLocale } = useI18n();
  const { displayName, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const { canToggle, setPreferred } = useNewUi();
  const dark = theme !== "daylight";
  return (
    <div className="flex flex-col gap-2 border-t p-3" style={{ borderColor: "var(--ds-border)" }}>
      <p className="truncate px-1 font-medium">{displayName}</p>
      <div className="flex gap-1" role="group" aria-label={t("newShell.language")}>
        {LOCALES.map((l) => (
          <button key={l} type="button" className="ds-btn ds-btn-sm flex-1" aria-pressed={l === locale} style={l === locale ? { borderColor: "var(--ds-brand)", background: "var(--ds-brand-soft)" } : undefined} onClick={() => void setLocale(l)}>
            {l.toUpperCase()}
          </button>
        ))}
      </div>
      <button type="button" className="ds-btn w-full justify-start" onClick={() => setTheme(dark ? "daylight" : "graphite")}>
        {dark ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
        {dark ? t("newShell.themeLight") : t("newShell.themeDark")}
      </button>
      {canToggle ? (
        <button
          type="button"
          className="ds-btn w-full justify-start"
          onClick={() => {
            onDone();
            setPreferred(false);
          }}
        >
          <LayoutGrid className="h-4 w-4" aria-hidden /> {t("newShell.classic")}
        </button>
      ) : null}
      <button type="button" className="ds-btn w-full justify-start" onClick={() => void signOut()}>
        <LogOut className="h-4 w-4" aria-hidden /> {t("newShell.signOut")}
      </button>
    </div>
  );
}

// ── The shell ────────────────────────────────────────────────────────────────

/**
 * The new app shell (prompt 16), shown instead of the classic sidebar and top bar when
 * useNewUi().active. Existing pages render unchanged as `children` below the header.
 * References: nav/nav-multi-product-launcher-nav (launcher), nav/nav-app-bar-with-search-and-tabs
 * (search, bell, avatar, app tabs), nav/nav-workspace-switcher-nav (company switcher),
 * nav/nav-breadcrumb-page-header (breadcrumbs), nav/nav-mobile-drawer-menu and
 * nav/nav-bottom-tab-bar (phones).
 */
export default function NewShell({ children, contentClassName, pageTitle }: { children: React.ReactNode; contentClassName?: string; pageTitle?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const { theme } = useTheme();
  const { brand } = useNewUi();
  const { isEnabled } = useEnabledModules();
  const { apps, current, currentItemPath } = useShellApps();
  const crumbs = useBreadcrumbTrail();
  const notifications = useNotifications();
  const quickActions = useQuickActions();
  const mod = useModifierKey();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const dsTheme = theme === "daylight" ? "light" : "dark";
  const aiEnabled = isEnabled("ai");
  const backButton = shellBackButton(pathname, current?.id ?? null);

  const groups = useMemo<PaletteGroup<PaletteAction>[]>(() => {
    const go = (href: string) => () => {
      markShellNavigation();
      router.push(href);
    };
    return [
      ...apps.map((app) => ({
        id: app.id,
        heading: app.title,
        commands: app.items.map((item) => ({ id: `${app.id}:${item.path}`, label: item.title, keywords: [app.title, item.path], icon: item.icon, onSelect: go(item.path) })),
      })),
      {
        id: "actions",
        heading: t("shell.quickActions"),
        commands: quickActions.map((a) => ({ id: `action:${a.id}`, label: a.label, icon: a.icon, onSelect: go(a.href) })),
      },
    ];
  }, [apps, quickActions, router, t]);

  const openAi = () => window.dispatchEvent(new CustomEvent(AI_OPEN_EVENT));

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[color:var(--erp-bg-main)]">
      <DesignScope theme={dsTheme} brand={brand}>
        <header className="ds-shell-header">
          <div className="flex h-14 items-center gap-1.5 px-3 md:gap-2 md:px-4">
            <div className="hidden md:block">
              <LauncherPopover apps={apps} />
            </div>
            <WorkspaceSwitcher />
            <span className="mx-1 hidden h-6 w-px md:block" style={{ background: "var(--ds-border)" }} aria-hidden />
            {current && backButton.show ? (
              <ShellBackButton app={current} href={backButton.href} />
            ) : (
              <ShellLink href={current?.href ?? "/apps"} className="min-w-0 truncate text-[length:var(--ds-text-base)] font-semibold" style={{ color: "var(--ds-text)" }}>
                {current?.title ?? t("newShell.apps")}
              </ShellLink>
            )}

            <div className="flex flex-1 justify-center">
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                className="ds-input hidden max-w-md items-center gap-2 text-left md:flex"
                style={{ color: "var(--ds-text-subtle)", cursor: "pointer" }}
                aria-label={t("newShell.search")}
              >
                <Search className="h-4 w-4 shrink-0" aria-hidden />
                <span className="flex-1 truncate">{t("newShell.searchHint")}</span>
                <kbd className="ds-kbd">{mod} K</kbd>
              </button>
            </div>

            <span className="md:hidden">
              <button type="button" className="ds-icon-btn" aria-label={t("newShell.search")} onClick={() => setPaletteOpen(true)}>
                <Search className="h-5 w-5" aria-hidden />
              </button>
            </span>
            <div className="hidden md:block">
              <QuickActions
                trigger={
                  <button type="button" className="ds-btn ds-btn-primary ds-btn-sm">
                    <Plus className="h-4 w-4" aria-hidden /> {t("shell.quickActions")}
                  </button>
                }
              />
            </div>
            <div className="hidden md:block">
              <NotificationsButton items={notifications} />
            </div>
            {aiEnabled ? (
              <span className="hidden md:block">
                <button type="button" className="ds-icon-btn" aria-label={t("newShell.assistant")} onClick={openAi}>
                  <Sparkles className="h-5 w-5" aria-hidden />
                </button>
              </span>
            ) : null}
            <div className="hidden md:block">
              <UserMenu />
            </div>
            <span className="md:hidden">
              <button type="button" className="ds-icon-btn" aria-label={t("newShell.menu")} onClick={() => setDrawerOpen(true)}>
                <Menu className="h-5 w-5" aria-hidden />
              </button>
            </span>
          </div>

          {current && current.items.length > 1 ? (
            <nav aria-label={t("newShell.appMenu", { app: current.title })} className="overflow-x-auto px-4" style={{ borderTop: "1px solid var(--ds-border)" }}>
              <ul className="flex gap-5">
                {current.items.map((item) => (
                  <li key={item.path}>
                    <ShellLink href={item.path} className="ds-tab" aria-current={item.path === currentItemPath ? "page" : undefined}>
                      {item.title}
                    </ShellLink>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}

          {crumbs.length > 1 ? (
            <div className="flex items-center px-4 py-2" style={{ borderTop: "1px solid var(--ds-border)" }}>
              <Breadcrumbs crumbs={crumbs} />
            </div>
          ) : null}
        </header>

        <CommandPalette
          groups={groups}
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          labels={{
            title: t("newShell.search"),
            placeholder: t("newShell.searchHint"),
            empty: t("newShell.searchEmpty"),
            navigate: t("newShell.paletteNavigate"),
            select: t("newShell.paletteSelect"),
            close: t("newShell.close"),
          }}
        />
        <MobileDrawer key={pathname} open={drawerOpen} onOpenChange={setDrawerOpen} apps={apps} current={current} currentItemPath={currentItemPath} />
      </DesignScope>

      <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-[var(--erp-content-padding-x)] py-[var(--erp-content-padding-y)] pb-24 md:pb-[var(--erp-content-padding-y)] ${contentClassName ?? ""}`}>
        {pageTitle ? <h3 className="erp-page-title">{pageTitle}</h3> : null}
        {children}
      </div>

      <DesignScope theme={dsTheme} brand={brand}>
        <nav aria-label={t("newShell.mobileNav")} className="fixed inset-x-0 bottom-0 z-30 md:hidden" style={{ background: "var(--ds-surface)", borderTop: "1px solid var(--ds-border)", paddingBottom: "env(safe-area-inset-bottom)" }}>
          <ul className="grid h-16 grid-cols-5 items-end pb-1.5">
            <li>
              <ShellLink href="/apps" className="flex flex-col items-center gap-0.5 text-[10px]" style={{ color: pathname === "/apps" ? "var(--ds-text)" : "var(--ds-text-muted)" }} aria-current={pathname === "/apps" ? "page" : undefined}>
                <LayoutGrid className="h-5 w-5" aria-hidden />
                {t("newShell.apps")}
                {pathname === "/apps" ? <span className="h-1 w-1 rounded-full" style={{ background: "var(--ds-text)" }} aria-hidden /> : null}
              </ShellLink>
            </li>
            <li>
              <button type="button" className="flex w-full flex-col items-center gap-0.5 text-[10px] ds-muted" onClick={() => setPaletteOpen(true)}>
                <Search className="h-5 w-5" aria-hidden />
                {t("newShell.search")}
              </button>
            </li>
            <li className="flex justify-center">
              <QuickActions
                trigger={
                  <button type="button" className="-mt-6 grid h-14 w-14 place-items-center rounded-full" style={{ background: "var(--ds-text)", color: "var(--ds-surface)", boxShadow: "var(--ds-elevation-3)" }} aria-label={t("shell.quickActions")}>
                    <Plus className="h-6 w-6" aria-hidden />
                  </button>
                }
              />
            </li>
            <li>
              <NotificationsButton items={notifications} tab />
            </li>
            <li>
              <button type="button" className="flex w-full flex-col items-center gap-0.5 text-[10px] ds-muted" onClick={() => setDrawerOpen(true)}>
                <Menu className="h-5 w-5" aria-hidden />
                {t("newShell.menu")}
              </button>
            </li>
          </ul>
        </nav>
      </DesignScope>
    </div>
  );
}
