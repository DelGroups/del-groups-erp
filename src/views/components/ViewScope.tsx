"use client";

import React, { useMemo, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import { useAuth } from "@/components/auth/AuthProvider";
import { useNewUi } from "@/components/shell/NewUiProvider";
import { DesignScope, ToastProvider } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/ThemeProvider";
import type { Formatter } from "../logic";
import type { FilterContext } from "../types";

/**
 * Page frame of a view-engine screen: the usual page layout (route permission guard) with the
 * design-system scope in the user's theme and the tenant brand colour, and toasts.
 */
export function ViewScope({ children }: { children: React.ReactNode }) {
  return (
    <PageLayout>
      <ViewToastScope className="mx-auto w-full max-w-[100rem] rounded-[var(--ds-radius-xl)] p-3 md:p-5">{children}</ViewToastScope>
    </PageLayout>
  );
}

/**
 * The design-system scope (user's theme, tenant brand) and toasts of ViewScope, without the page
 * layout. A screen wraps its outer component in it when the screen itself calls useToast(), or
 * renders a side panel or dialog that does, next to <EngineScreen> rather than inside it:
 * useToast() throws without a provider above it (FIX-1). Without a className it adds no box and
 * no text style of its own (ds-scope-contents), so wrapping the page frame changes nothing on
 * screen; the <EngineScreen> inside keeps its own scope, and toasts and panels portal into the
 * same overlay layer.
 */
export function ViewToastScope({ children, className = "ds-scope-contents" }: { children: React.ReactNode; className?: string }) {
  const { theme } = useTheme();
  const { brand } = useNewUi();
  const { t } = useI18n();
  return (
    <DesignScope theme={theme === "daylight" ? "light" : "dark"} brand={brand} className={className}>
      <ToastProvider closeLabel={t("common.close")}>{children}</ToastProvider>
    </DesignScope>
  );
}

/** Texts and number/date formats of the current language. */
export function useFormatter(): Formatter {
  const { t, locale } = useI18n();
  return useMemo(() => ({ t, locale }), [t, locale]);
}

/** Values filters refer to: the signed-in user and the time the screen opened. */
export function useFilterContext(): FilterContext {
  const { user } = useAuth();
  const [now] = useState(() => new Date());
  const userId = user?.id ?? null;
  return useMemo(() => ({ userId, now }), [userId, now]);
}
